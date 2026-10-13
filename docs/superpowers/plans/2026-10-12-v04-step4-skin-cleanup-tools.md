# v0.4 Step 4 — 膚質去除型工具 (祛痘, 勻膚, 膚色, 黑眼圈, 法令紋, 白牙, 亮眼) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the seven 膚質 tools to the 美膚 strip of the photo editor — tap-to-heal 祛痘 plus the per-person sliders 勻膚, 膚色, 黑眼圈, 法令紋, 白牙 and 亮眼 — rendered in O before makeup by three new engine passes (heal P0b, tone field P0c, retouch P0d), saved in 最近編輯 and undoable, editor-only.

**Architecture:** Pure modules come first: the six `tone.*` params and the `Spot` list in `EditState` (`src/edit/spots.ts`), the landmark region geometry (`toneGeometry.ts`), and CPU references (`toneCpu.ts`, `healCpu.ts`) that the GLSL is pinned to by hash. The GPU side draws two ¼-res region targets (R, Q), builds a cached ⅛-res tone field at working resolution, runs a full-resolution retouch and a heal pass (copy, robust 32-sample ring, Poisson-membrane spot quads), all before P1, ping-ponging the two existing full-size buffers. The UI adds the tone items (with step 2's divider) and a 祛痘 tap mode (pure `tapOutcome` in zoomPan, `SpotControls`, `SpotOverlay`) whose taps go client → V → O through step 3's `backMapCpu`; tiled exports pass `toneSource` and grow each tile window around the spots it meets.

**Tech Stack:** TypeScript 5.9, Preact 10, WebGL2 (core RGBA8 targets only), Vitest 5 (node environment, fake-indexeddb), Playwright 1.63 (Chromium + SwiftShader), pngjs 7, Node 24 scripts.

**Spec:** `docs/superpowers/specs/2026-10-12-skin-cleanup-tools-design.md` (called **S** below), inside the contract `docs/superpowers/specs/2026-10-12-v04-roadmap.md` (**C**; status accepted, every §12 question at its recommended default). Names consumed from earlier steps come from `2026-10-12-face-person-select-design.md` (step 1), `2026-10-12-adjust-and-looks-design.md` (step 2) and `2026-10-12-crop-and-fullres-export-design.md` (step 3).

## Reconciliation (step 4)

Checked against the code at the step base `0203207` (steps 1–3 fully committed, fixes included). Task 1 Step 1's name check prints `ok` for every line. Every name this plan produces is unchanged, so steps 5–6 still find them. These edits were made:

- **Anchors:** the **Files** lines and step instructions cite `0203207` lines where they had moved (types, debug, mask, global-setup, .gitignore, NOTICE, pipeline, index, still, exporter, zoomPan, panelModel, Slider, BeautyPanel, icons, theme.css, Editor, bench main). Line numbers inside spec quotes and code comments may still read older lines: when an anchor has moved, find the quoted code.
- **Line endings** (`git ls-files --eol` at `0203207`): the CRLF working-tree files this plan edits are `src/types.ts`, `src/engine/index.ts`, `src/engine/pipeline.ts`, `src/engine/passes/mask.ts`, `src/ui/panelModel.ts`, `src/ui/components/Slider.tsx`, `src/ui/components/BeautyPanel.tsx`, `src/ui/icons.tsx`, `src/ui/theme.css`, `src/ui/screens/zoomPan.ts` and `src/bench/main.ts`. Every other edited file is LF.
- **Task 1:** step 1's `state.test.ts` case 'live: everything but 美體 is offered in the camera' must also exempt the `'tone'` group (the six are `live: false`).
- **Task 3:** step 3 already passes the entry's `{ width, height }` from `normalizeEntry` (`history.ts:213`), so `history.ts` is not changed and both history tests pass once Task 2 is in. The second history test stores person `f3`, because `sanitizeEditState` always bounds owners by the stored persons. `legacyProjection` writes the six `tone.*` values as **neutral** instead of dropping their keys. The projection stays a complete `BeautyParams`, so step 1's round-trip tests (`legacy.test.ts`, the `lens.test.ts` parity case, `migrate.test.ts`) still pass. Only the 500-random round trip generates its raw tone values as neutral, since a v1 record never holds a 膚質 value. The stored `params` are the same as with dropped keys, because `sanitizeParams` fills them with the same neutral values. This keeps S §5's "0.3 opens a 0.4 entry without them".
- **Task 5:** `buildMaskGeometry` returns step 1's `[count, base, fanEnd]`.
- **Task 7:** `global-setup.ts` already imports `existsSync, statSync` and has a `stale()` helper; the fixture uses it.
- **Task 11:** `base` / `baseFb` are declared right after the P0 mask block (`pipeline.ts:456-457`), and the tone block goes after them. Step 3's `releaseBuffers` loops over every FBO, so it gets the explicit six-name list. `still.ts` publishes the stats in `flush()`, next to step 3's `renderCount`.
- **Task 13:** the exporter's `ctxOpts` line carries a type annotation, and the replacement keeps it.
- **Task 15:** `ZoomPanOptions` already exists (step 1 / 3) with `onTap(uv, layer: DOMRect)` and `resetWhen`, read through `optsRef`. `spotTap` takes the same `(uv, layer)` form. In view mode a `pointercancel` still never calls `onTap` (step 1), but it still counts toward the double tap.
- **Task 16:** `ends` goes on `SliderView`, which is what `SliderRow` reads (`SliderBinding` extends it). `sliderFor` keeps step 1's `usable` gate and `decorate`. Tone dots use step 1's `itemDot`. `aria-valuetext` keeps 「，各人不同」. BeautyPanel's note line is step 1's `bodyNoteFor(body, lens, sel)`. The valueText test goes into the existing `Slider.test.tsx`. The Editor's selection is `selected` (there is no `personSel`), and `selectPerson(page, 0)` selects 全部. `tabHasValue`'s 4th parameter and tone.spec's `defect` helper move to Task 17, where they are first used (`noUnusedParameters` / `noUnusedLocals`).
- **Task 17:** `photoScoped` handles `sel.skin === 'spot'`, because `photoLike` takes a `ParamId`. The Editor already has a `scope` (`photoScoped`), so the 清除 scope is named `clearSc`. The tap builds its frame with step 1's `frameOf(cur, s)` (there is no `frameRef`). The person-tap callback becomes the named `onPersonTap`. The `SpotControls` ternary keeps step 3's `SliderRow` props (`straightenView`, `emptyText`). `backMapFrameOf` applies each face's `warpScale` (λ_f), as `index.ts` does. BeautyPanel passes `skin` to `tabHasValue`.
- **Task 19:** `main.ts` already imports an equal `median` from `./report`. The bench input sets the geometry on `RenderInput`, because the engine reads `input.geometry`, not `photo.geometry`.
- **Task 20:** the base file, the commit count and Step 5's expected test edits follow the changes above and the workflow's commits.
- **Commits:** the `git commit -m "v0.4 step 4 (N/20): …"` blocks show each task's file list and intent. The workflow's message format replaces them: `v0.4 step 4 task <N>: <title>`, fixes `v0.4 step 4 task <N> fix: …`, written to a file, committed with `git commit -F` and ending with the `Co-Authored-By` line. Task 9's calibration table goes into its message body.
- **Imports:** put new names into a file's existing import declarations. A name that is already imported (for example the Editor's `debug`, `reportError`, `toast` and `haptic`) is not imported again.

## Global Constraints

- Contract §12 defaults are decisions: one spot list per photo, each spot tagged with its `owner` (#24); 膚質 runs in O **before** 美型／美妝 (#25); editor only, never in the camera (#26); 膚色 reaches face + upper neck only (#27); one 勻膚 slider (#28); no 一鍵祛痘 (#29); 全部清除 / 清除此人 need a second tap 「確定清除？」 within 3 s (#30); every beauty preset resets the tone items to neutral (#31).
- Invariant (C §1.1): a one-person photo edited with v0.3 items only renders as in v0.3 (≤ 1/255 per channel; `parity.spec.ts`). With neutral tone values and no spots, none of the passes `heal`, `toneField`, `retouch` runs and the frame is bit-identical to step 3 (S §4.1).
- `COMPOSITE_FS` (both step-2 variants) and `RESHAPE_FS` are not edited by step 4; composite texture unit 9 stays free (S A6).
- No new full-size buffer (S §4.1, §4.7); every new GPU target is core-WebGL2 `RGBA8` (no `EXT_color_buffer_float`).
- `SPOT_CAP = 100`, `HEAL_RING_SAMPLES = 32`, both in `src/config/limits.ts` (S §3.3).
- Spot radius: `k × reference face width`, k = 小 0.018, 中 0.030, 大 0.048, clamped to [3 working px, 0.04 × O short edge]; default size 中, remembered for the app session only (S §2.3).
- Copy, verbatim (S §2.4, C §2.6): strip labels 勻膚 · 膚色 · 黑眼圈 · 法令紋 · 白牙 · 亮眼 · 祛痘; 膚色 ends 冷 / 暖; hint 「點一下痘痘或瑕疵即可去除」; 大小 · 小 · 中 · 大; 「全部清除（{n}）」 / 「清除此人（{n}）」 / 「確定清除？」; 「祛痘點已達上限」; 「眼睛和嘴巴不適用祛痘」; 「放大畫面可以點得更準」; 「嘴巴閉合時看不到牙齒，白牙效果不明顯」; 「閉眼時亮眼效果不明顯」; 「未偵測到臉部，膚質工具不會套用」; 「基本模式不支援膚質工具」; 「臉部偵測重新啟動中，膚質工具暫不套用」 / 「臉部偵測暫停，膚質工具暫不套用」 / 「臉部偵測失敗，膚質工具暫不套用」.
- On-device only: CSP stays `connect-src 'self'`; MediaPipe 0.10.35; no third-party asset; the seven icons are original line icons (24 × 24 grid, 1.75 px stroke, `icons.tsx:1`).
- `package.json` version stays `0.3.0`. Every commit is local (`git commit`); never `git push`, never deploy.
- Line endings: every existing file keeps its working-tree ending. `git ls-files --eol <file>` shows `w/crlf` or `w/lf`; the Edit tool preserves it. Never rewrite a CRLF file through a tool that normalizes to LF. New files are LF (`.gitattributes`: `* text=auto eol=lf`).
- Names consumed from steps 1–3 are the names their specs and plans give (`docs/superpowers/plans/2026-10-12-v04-step{1,2,3}-*.md`; each task's **Consumes** cites them, with the step-plan task that defines them where it matters). Task 1 Step 1 checks every one in the code. Where the code uses a different name for the same thing, use the code's name wherever this plan writes the spec's name, and say so in that task's commit message.
- An app e2e run needs a production build (`tests/e2e/global-setup.ts` refuses to start without `dist/`): run `npm run build` before `npx playwright test <spec>`. `npm run test:e2e` builds by itself.
- Sub-step gates (S §1.3: each sub-step ends green with a local commit): the last task of each run of sub-steps — Task 3 (4a), Task 6 (4b), Task 11 (4c), Task 14 (4d; Task 13 of 4e runs before it), Task 17 (4e) and Task 19 (4f) — runs `npm run typecheck && npm test && npm run test:e2e` after its own tests and before its commit; a failure is fixed in the task that owns the code. Task 20 is the step gate.

## Review Focus

1. **Context loss while a tone field is cached** — after `webglcontextlost` → restored, the next frame must rebuild the field (never sample deleted textures) and draw the same pixels. Test: Task 11, `tone-engine.spec.ts` "context loss".
2. **A quick double tap in 祛痘 mode** — two spots and two undo steps, never a fit-to-view; the second donor avoids the first spot. Tests: Task 15 `tapOutcome` (two taps 100 ms apart in spot mode → two taps, `fit` false), Task 13 `planSpot` (an existing spot excludes overlapping donors).
3. **A stale 「確定清除？」** — after ↶/↷, a new spot or a chip change, the armed clear must disarm, so a second tap can never clear spots the user did not see counted. Test: Task 17 `clearTap` + the Editor reset rule (`clearArmKey`).
4. **A tap at the image border or in a region too small for a donor** — fill mode, a smooth finite disc, never black or NaN. Tests: Task 13 (fill mode at the edge), Task 12 (`healCpu` fill mode), Task 14 (GPU border spot equals `healCpu`).
5. **A tone field reused across photos of the same size** — the cache key must include the source identity, so opening another photo (or an engine swap that keeps the size) rebuilds. Test: Task 11 `toneJob.test.ts` (two bitmaps of equal size give different keys).

---

## File Structure

| File | Status | Responsibility | Task |
|---|---|---|---|
| `src/types.ts` | modify | `'tone'` group, six tone ids, `Spot`, `SpotSize`, `PhotoParams.spots`, `DebugState` fields, `RenderStats.toneBuilt`, `RenderInput.toneSource` | 1, 11 |
| `src/config/limits.ts` (step 1) | modify | `SPOT_CAP`, `HEAL_RING_SAMPLES` | 1 |
| `src/engine/params.ts` | modify | six `ParamDef` rows | 1 |
| `src/edit/state.ts` (step 1) | modify | `defaultPhoto().spots`, spots in `sanitizePhoto`; `renamePersons` remaps owners | 1, 2, 3 |
| `src/app/debug.ts`, `src/ui/debug.ts` | modify | initial debug fields | 1 |
| `src/edit/spots.ts` | create | spot list edits, sanitize, owners; radius, regions, snap, donor (`planSpot`) | 2, 13 |
| `src/edit/toneCopy.ts` | create | every step-4 string | 3 |
| `src/edit/lens.ts`, `src/edit/legacy.ts` (step 1) | modify | tone gate, ⊘ covers tone, v1 projection | 3 |
| `src/store/history.ts` (step 1's `normalizeEntry`) | unchanged | already sanitizes a loaded edit with the entry's O size (step 3), so spots survive; Task 3 adds the tests | 3 |
| `src/engine/passes/toneGeometry.ts` | create | face frame, gates, region triangle lists, R/Q draw lists, `TONE_ZERO` | 4, 5 |
| `src/engine/passes/mask.ts` | modify | optional ring width for `buildMaskGeometry` | 5 |
| `src/engine/passes/toneMask.ts` | create | GL pass drawing R and Q | 6 |
| `src/engine/toneRaster.node.ts` | create | test-only CPU raster of the draw lists | 6 |
| `scripts/gen-tone-fixture.mjs` | create | synthetic defect fixture + JSON | 7 |
| `src/engine/shaders/tone.ts` | create | `TONE` table, shared kernel math; field and retouch GLSL | 8, 11 |
| `src/engine/toneCpu.ts` | create | CPU reference of P0c and P0d | 8 |
| `src/engine/toneStats.node.ts` | create | test-only fixture statistics (targets, keeps) | 9 |
| `src/engine/pipeline.ts` | modify | ping-pong helper; P0b, P0c, P0d; field cache; `prepareToneField` | 10, 11, 14, 18 |
| `src/engine/toneJob.ts` | create | which step-4 passes run, draw lists, cache key | 11 |
| `src/engine/passes/toneField.ts` | create | GL passes D8 → Mn8 → L → Δ8, retouch | 11 |
| `src/engine/index.ts` | modify | tone job in `job()`, `toneBuilt`, tile preparation | 11, 18 |
| `src/app/still.ts` | modify | debug `passes` / `toneBuilds`; `toneSource` in `tileInput`, `spotBounds` in `bounds` | 11, 18 |
| `src/engine/shaders/heal.ts` | create | ring and spot-quad GLSL | 12 |
| `src/engine/healCpu.ts` | create | CPU reference of P0b | 12 |
| `src/engine/passes/heal.ts` | create | GL heal pass | 14 |
| `src/edit/patch.ts` | create | patch plan (pure) and `readPatch` (2D canvas) | 13 |
| `src/media/exporter.ts` | modify | `SurfaceOptions.willReadFrequently` | 13 |
| `src/ui/screens/zoomPan.ts` | modify | pure `tapOutcome`, spot tap mode | 15 |
| `src/ui/panelModel.ts` | modify | tone items, gates, notes, ends; 祛痘 item, mode, clear rules | 16, 17 |
| `src/ui/components/Slider.tsx`, `BeautyPanel.tsx`, `src/ui/icons.tsx`, `src/ui/theme.css` | modify | end captions, skin note, seven icons, styles | 16, 17 |
| `src/ui/components/SpotControls.tsx`, `SpotOverlay.tsx` | create | 祛痘 controls and tap rings | 17 |
| `src/ui/screens/Editor.tsx` | modify | skin context, 祛痘 mode, tap → spot | 16, 17 |
| `src/engine/backMapFrame.ts` | create | the tap's `BackMapFrame` (step 3) from the shown frame: face table and 美體 field | 17 |
| `src/media/exportPlan.ts` (step 3) | modify | `spotWindowGrowth`, `step4Active`, `spotBounds` (fill step 3's `TileBounds.spotWindowGrowth` / `oSpacePasses` hooks) | 18 |
| `src/bench/toneBench.ts`, `src/bench/main.ts` | create / modify | 膚質 bench rows | 19 |
| `tests/e2e/global-setup.ts`, `.gitignore`, `LICENSES/NOTICE.txt` | modify | fixture generation and notice | 7 |
| `tests/e2e/pages/tone.html`, `tone.ts`, `tests/e2e/tone-engine.spec.ts` | create | engine harness | 6, 11, 14, 18 |
| `tests/e2e/tone.spec.ts` | create | app flows | 16, 17, 18 |

---

### Task 1: Tone params, the Spot model, caps and debug fields

**Files:**
- Modify: `src/types.ts:6` (`ParamGroup`), `:8-47` (`ParamId`), step 1's `PhotoParams` (`:187-200`), `:668-697` (`DebugState`)
- Modify: `src/config/limits.ts` (created by step 1)
- Modify: `src/engine/params.ts:6-9` (after the four 美膚 rows)
- Modify: `src/edit/state.ts` (step 1: `defaultPhoto`, `:54-59`)
- Modify: `src/app/debug.ts:8-23`, `src/ui/debug.ts:6-21`
- Test: `src/engine/params.test.ts`, `src/edit/state.test.ts`

**Interfaces:**
- Consumes: step 1 `ParamDef.scope: 'photo' | 'person'`, `ParamDef.live: boolean`, `PhotoParams`, `PersonId`, `defaultPhoto()` (C §3.1–3.2, step-1 spec §3.2); step 2's `ParamGroup` member `'adjust'` and its 12 `adjust.*` ids.
- Produces:
  ```ts
  // src/types.ts
  export type ParamGroup = /* step 1–2 members */ | 'tone';
  // ParamId gains: 'tone.even' | 'tone.warmth' | 'tone.darkCircle' | 'tone.nasolabial' | 'tone.teeth' | 'tone.eyeBright'
  export interface Spot { x: number; y: number; r: number; dx: number; dy: number; owner: PersonId | null }
  export type SpotSize = 'S' | 'M' | 'L';
  // PhotoParams gains: spots: readonly Spot[];
  // DebugState gains: spots: number; lastSpot: Spot | null; toneBuilds: number; passes: string[];
  // src/config/limits.ts
  export const SPOT_CAP = 100;
  export const HEAL_RING_SAMPLES = 32;
  ```

- [x] **Step 1: Check the consumed names and record the baseline**

Run (Git Bash, repo root; HEAD is the plan's reconcile commit, which changes no code, on top of the step base `0203207`):
```bash
mkdir -p .superpowers
git rev-parse HEAD > .superpowers/step4-base.txt
git ls-files --eol > .superpowers/step4-eol-before.txt
check() { if grep -qE "$2" "$1" 2>/dev/null; then echo "ok      $1  $2"; else echo "MISSING $1  $2"; fi; }
check src/types.ts "scope: ('photo' \| 'person'|ParamScope)"
check src/types.ts "live: boolean"
check src/types.ts "interface PhotoParams"
check src/types.ts "interface DetectionCache"
check src/types.ts "interface RenderFace"
check src/types.ts "renderTile"
check src/types.ts "sourceWindow"
check src/edit/state.ts "export function defaultPhoto"
check src/edit/state.ts "export function neutralPerson"
check src/edit/state.ts "export function sanitizeEditState"
check src/edit/state.ts "export function assignPersons"
check src/edit/state.ts "export function resetAll"
check src/edit/state.ts "export function editKey"
check src/store/history.ts "sanitizeEditState\(r\.edit"
check src/edit/legacy.ts "export function legacyProjection"
check src/edit/lens.ts "export function lensFor"
check src/edit/migrate.ts "export function openState"
check src/edit/state.ts "export function renamePersons"
check src/engine/passes/faceCap.ts "export function capsFor"
check src/engine/shaderHash.ts "export function shaderHash"
check src/engine/backMapCpu.ts "export function backMapCpu"
check src/geometry/view.ts "export function viewSize"
check src/media/exportPlan.ts "export function planExport"
check src/media/exporter.ts "function createSurface"
check src/engine/pipeline.ts "srcSize"
check src/engine/pipeline.ts "oAspect"
check src/ui/panelModel.ts "divider\?: 'before'"
check src/ui/screens/zoomPan.ts "onTap"
check src/app/still.ts "tileInput"
check tests/e2e/fixtures.ts "export async function selectPerson"
check tests/fixtures/group_faces.png "."
check tests/e2e/parity.spec.ts "."
check tests/e2e/export.spec.ts "."
```
Expected: every line starts with `ok`. For a `MISSING` line, find the same concept in the code (`git grep -n` for the spec's wording) and note the real name; use it wherever this plan writes the spec's name, and list the mapping in the commit message of each task that touches it.

Then confirm the baseline is green:
```bash
npm run typecheck && npm test
```
Expected: typecheck prints nothing; Vitest ends with `Test Files … passed`.

- [x] **Step 2: Write the failing tests**

Append to `src/engine/params.test.ts` (it already imports `PARAM_DEFS`, `neutralValue`, `paramDef`, `paramsInGroup`, `presetDef` and defines `PRESET_IDS`):
```ts
describe('step 4 tone params (skin-cleanup spec §3.1)', () => {
  const TONE: ParamId[] = ['tone.even', 'tone.warmth', 'tone.darkCircle', 'tone.nasolabial', 'tone.teeth', 'tone.eyeBright'];

  it('adds the six tone params in strip order: person-level, editor-only, neutral by default', () => {
    expect(paramsInGroup('tone').map((d) => d.id)).toEqual(TONE);
    expect(paramsInGroup('tone').map((d) => d.label)).toEqual(['勻膚', '膚色', '黑眼圈', '法令紋', '白牙', '亮眼']);
    expect(paramsInGroup('tone').map((d) => d.icon)).toEqual(['even', 'tone', 'darkCircle', 'nasolabial', 'teeth', 'eyeBright']);
    for (const d of paramsInGroup('tone')) {
      expect(d.scope).toBe('person');
      expect(d.live).toBe(false);
      expect(d.bidirectional).toBe(d.id === 'tone.warmth');
      expect(d.default).toBe(neutralValue(d));
    }
  });

  it('every beauty preset holds them neutral (C §3.4, §12 #31)', () => {
    for (const id of PRESET_IDS) for (const t of TONE) expect(presetDef(id).values[t]).toBe(neutralValue(paramDef(t)));
  });
});
```
In the existing `describe('PARAM_DEFS schema (RB §5)')` of the same file:
- raise the asserted `PARAM_DEFS` length (both `toHaveLength` and the `Set` size) by 6 — after steps 1–2 it is 38, so 44;
- add `'tone'` to `GROUPS`;
- add `'tone.warmth'` to `BIDIRECTIONAL`;
- add to the `expected` table of 'defaults match the RB §5 table':
  ```ts
      'tone.even': 0,
      'tone.warmth': 0.5,
      'tone.darkCircle': 0,
      'tone.nasolabial': 0,
      'tone.teeth': 0,
      'tone.eyeBright': 0,
  ```
- in step 1's scope-table test (`git grep -n "scope" src/**/*.test.ts` finds it; C §3.1 "a unit test checks … that the table below matches PARAM_DEFS"), add the six tone ids to the person list.

In `src/edit/state.test.ts`, step 1's case `'live: everything but 美體 is offered in the camera'` (`state.test.ts:42-44`) asserts `d.live === (d.group !== 'body')`; the six tone items are editor-only too, so it becomes
```ts
    for (const d of PARAM_DEFS) expect(d.live, d.id).toBe(d.group !== 'body' && d.group !== 'tone');
```
(its title may add 「and 膚質」). The scope-table case in the same describe (`state.test.ts:28-41`) lists the person items with `expect.arrayContaining`, so adding the tone ids there is optional; its `PHOTO_IDS` list is unchanged.

Append to `src/edit/state.test.ts`:
```ts
describe('step 4: spots in the photo params', () => {
  it('defaultPhoto has no spots (重置 clears them, C §3.4)', () => {
    expect(defaultPhoto().spots).toEqual([]);
  });
});
```
(import `defaultPhoto` from `./state` if the file does not yet.)

- [x] **Step 3: Run the tests to see them fail**

Run: `npx vitest run src/engine/params.test.ts src/edit/state.test.ts`
Expected: FAIL — `expected [] to deeply equal [ 'tone.even', … ]` and `expected undefined to deeply equal []` (and typecheck-level errors in the IDE for the unknown ids).

- [x] **Step 4: Implement**

`src/types.ts` (CRLF) — append `| 'tone'` to `ParamGroup` (line 6) and the six ids to `ParamId` (after step 2's last id `'adjust.vignette'`, line 47, moving its `;` to the new last line):
```ts
  | 'tone.even'
  | 'tone.warmth'
  | 'tone.darkCircle'
  | 'tone.nasolabial'
  | 'tone.teeth'
  | 'tone.eyeBright';
```
Below `HeightBand` (after line 147) add:
```ts
/** 祛痘 spot (skin-cleanup spec §3.2; replaces C §3.2's Spot). Photo-level, stored in EditState.photo.spots. */
export interface Spot {
  /** O-space centre, normalized by W_O and H_O (top-left origin) */
  x: number;
  y: number;
  /** radius, fraction of the O short edge */
  r: number;
  /** donor offset, fraction of the O short edge (isotropic); dx = dy = 0 → fill mode (no donor found) */
  dx: number;
  dy: number;
  /** the person whose face region (else body mask) held the centre when it was tapped; null = elsewhere */
  owner: PersonId | null;
}
/** 祛痘 大小 小／中／大 */
export type SpotSize = 'S' | 'M' | 'L';
```
(If step 1 already declared a `Spot`, replace it with this one; at `0203207` none exists.) In step 1's `PhotoParams` (`types.ts:187-200`) add, after the last field (step 3's `geometry`):
```ts
  /** 祛痘 spots, at most SPOT_CAP (skin-cleanup spec §3.2, C §5.3) */
  spots: readonly Spot[];
```
In `DebugState` (`types.ts:668-697`) add:
```ts
  /** 祛痘 spots of the open photo (editor; skin-cleanup spec §3.2) */
  spots: number;
  /** the spot added last in this page session; null before the first */
  lastSpot: Spot | null;
  /** tone-field (P0c) rebuilds in this page session */
  toneBuilds: number;
  /** pass list of the last display frame */
  passes: string[];
```

`src/config/limits.ts` — append:
```ts
/** 祛痘: spots per photo (C §5.3); measured fallback 50 (skin-cleanup spec §6) */
export const SPOT_CAP = 100;
/** 祛痘: ring samples per spot (skin-cleanup spec §4.5); measured fallback 24 (spacing 0.34 r) */
export const HEAL_RING_SAMPLES = 32;
```

`src/engine/params.ts` — after the `skin.sharpen` row (line 9):
```ts
  // 膚質 (skin-cleanup spec §3.1): person-level face items, editor-only, neutral by default and in every preset
  { id: 'tone.even', label: '勻膚', group: 'tone', bidirectional: false, default: 0, icon: 'even', scope: 'person', live: false },
  { id: 'tone.warmth', label: '膚色', group: 'tone', bidirectional: true, default: 0.5, icon: 'tone', scope: 'person', live: false },
  { id: 'tone.darkCircle', label: '黑眼圈', group: 'tone', bidirectional: false, default: 0, icon: 'darkCircle', scope: 'person', live: false },
  { id: 'tone.nasolabial', label: '法令紋', group: 'tone', bidirectional: false, default: 0, icon: 'nasolabial', scope: 'person', live: false },
  { id: 'tone.teeth', label: '白牙', group: 'tone', bidirectional: false, default: 0, icon: 'teeth', scope: 'person', live: false },
  { id: 'tone.eyeBright', label: '亮眼', group: 'tone', bidirectional: false, default: 0, icon: 'eyeBright', scope: 'person', live: false },
```
(`PRESETS` builds `values` from `neutralValues()` / `defaultValues()`, so every preset holds these at neutral with no further change.)

`src/edit/state.ts` — in `defaultPhoto()` add `spots: [],` to the returned object. Run `npm run typecheck`; every `Property 'spots' is missing in type` error (object literals typed `PhotoParams`: at `0203207` the `photo` literal in `sanitizePhoto`, `state.ts:271-280`, and the one in `splitLegacy`, `legacy.ts:15`) gets `spots: []` — Task 2 replaces the one in `sanitizePhoto` with the sanitizer.

`src/app/debug.ts:8-23` and `src/ui/debug.ts:6-21` — add to the initial object:
```ts
    spots: 0,
    lastSpot: null,
    toneBuilds: 0,
    passes: [],
```

- [x] **Step 5: Run the tests and the typecheck**

Run: `npx vitest run src/engine/params.test.ts src/edit/state.test.ts && npm run typecheck`
Expected: PASS; typecheck prints nothing.

- [x] **Step 6: Commit**

```bash
git add src/types.ts src/config/limits.ts src/engine/params.ts src/edit/state.ts src/app/debug.ts src/ui/debug.ts src/engine/params.test.ts src/edit/state.test.ts
git add -u
git commit -m "v0.4 step 4 (1/20): tone params, Spot model, spot caps, debug fields" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Spot list edits and sanitizing

**Files:**
- Create: `src/edit/spots.ts`
- Modify: `src/edit/state.ts` (step 1's `sanitizePhoto`, which `sanitizeEditState` calls)
- Test: `src/edit/spots.test.ts`, `src/edit/state.test.ts`

**Interfaces:**
- Consumes: `Spot`, `SPOT_CAP` (Task 1); step 1 `EditState`, `Selection`, `PersonId`, `defaultPhoto()`, `neutralPerson()`, `sanitizeEditState(raw, personIds | null, oSize?)` (step-3 spec D13 adds `oSize`), `editKey(edit)` and `assignPersons(edit, ids: readonly PersonId[], primary, opts?)` (C §3.2, §3.4; all in `src/edit/state.ts`, step-1 plan Tasks 4–5).
- Produces (`src/edit/spots.ts`):
  ```ts
  export type ClearScope = PersonId | 'all';
  export function addSpot(edit: EditState, spot: Spot): EditState;          // returns `edit` itself when full
  export function clearSpots(edit: EditState, scope: ClearScope): EditState; // returns `edit` itself when nothing goes
  export function spotsInScope(edit: EditState, scope: ClearScope): number;
  export function clearScope(sel: Selection, selectablePersons: number): ClearScope;
  export function remapSpotOwners(spots: readonly Spot[], rename: (id: PersonId) => PersonId | null): Spot[];
  export function sanitizeSpot(raw: unknown, personIds: ReadonlySet<PersonId> | null): Spot | null;
  export function sanitizeSpots(raw: unknown, personIds: ReadonlySet<PersonId> | null, hasOSize: boolean): Spot[];
  ```

- [x] **Step 1: Write the failing tests**

Create `src/edit/spots.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { SPOT_CAP } from '../config/limits';
import type { EditState, Spot } from '../types';
import { defaultPhoto, neutralPerson } from './state';
import { addSpot, clearScope, clearSpots, remapSpotOwners, sanitizeSpot, sanitizeSpots, spotsInScope } from './spots';

const spot = (x: number, owner: string | null = null): Spot => ({ x, y: 0.5, r: 0.01, dx: 0.03, dy: 0, owner });
const edit = (spots: Spot[] = []): EditState => ({
  v: 2,
  photo: { ...defaultPhoto(), spots },
  persons: { f0: neutralPerson(), f1: neutralPerson() },
  template: neutralPerson(),
  primaryInit: null,
});

describe('addSpot / clearSpots (skin-cleanup spec §3.3)', () => {
  it('appends immutably and refuses the 101st spot by returning the same state', () => {
    const e0 = edit();
    const e1 = addSpot(e0, spot(0.1));
    expect(e1.photo.spots).toEqual([spot(0.1)]);
    expect(e0.photo.spots).toEqual([]);
    const full = edit(Array.from({ length: SPOT_CAP }, (_, i) => spot(i / SPOT_CAP)));
    expect(addSpot(full, spot(0.5))).toBe(full);
  });

  it('clears every spot, or only one owner’s; a clear that removes nothing is the same state (no undo step)', () => {
    const e = edit([spot(0.1, 'f0'), spot(0.2, 'f1'), spot(0.3, null), spot(0.4, 'f0')]);
    expect(clearSpots(e, 'all').photo.spots).toEqual([]);
    expect(clearSpots(e, 'f0').photo.spots).toEqual([spot(0.2, 'f1'), spot(0.3, null)]);
    expect(clearSpots(e, 'b0')).toBe(e);
    expect(spotsInScope(e, 'f0')).toBe(2);
    expect(spotsInScope(e, 'all')).toBe(4);
  });

  it('清除此人 only with one person of a group photo selected (§2.3)', () => {
    expect(clearScope({ kind: 'person', id: 'f1' }, 3)).toBe('f1');
    expect(clearScope({ kind: 'person', id: 'f0' }, 1)).toBe('all');
    expect(clearScope({ kind: 'all' }, 3)).toBe('all');
  });

  it('remaps owners through a rename; an unmatched owner becomes null (§5)', () => {
    const map = new Map([['f0', 'f2']]);
    expect(remapSpotOwners([spot(0.1, 'f0'), spot(0.2, 'f1'), spot(0.3, null)], (id) => map.get(id) ?? null)).toEqual([
      spot(0.1, 'f2'),
      spot(0.2, null),
      spot(0.3, null),
    ]);
  });
});

describe('sanitizeSpot / sanitizeSpots (§5)', () => {
  const ids = new Set(['f0', 'f1']);

  it('drops non-finite and far-outside spots, clamps the rest, nulls unknown owners, drops long donors', () => {
    expect(sanitizeSpot({ x: NaN, y: 0.5, r: 0.01, dx: 0, dy: 0, owner: null }, ids)).toBeNull();
    expect(sanitizeSpot({ x: 0.5, y: 0.5, r: Infinity, dx: 0, dy: 0, owner: null }, ids)).toBeNull();
    expect(sanitizeSpot({ x: 1.02, y: 0.5, r: 0.01, dx: 0, dy: 0, owner: null }, ids)).toBeNull();
    expect(sanitizeSpot({ x: 1.005, y: -0.005, r: 0.5, dx: 0.3, dy: 0, owner: 'b7' }, ids)).toEqual({ x: 1, y: 0, r: 0.04, dx: 0, dy: 0, owner: null });
    expect(sanitizeSpot({ x: 0.2, y: 0.3, r: 0.0001, dx: 0.01, dy: -0.02, owner: 'f1' }, ids)).toEqual({ x: 0.2, y: 0.3, r: 0.0005, dx: 0.01, dy: -0.02, owner: 'f1' });
    // the detection cache was dropped (null): owners are kept for the rematch
    expect(sanitizeSpot({ x: 0.2, y: 0.3, r: 0.01, dx: 0, dy: 0, owner: 'f5' }, null)?.owner).toBe('f5');
  });

  it('fuzz: every kept spot satisfies the invariants', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 3 - 1;
    const pick = (): unknown => [rnd(), rnd() * 0.05, NaN, Infinity, '0.3', null, undefined][Math.floor(Math.abs(rnd()) * 2.33) % 7];
    for (let i = 0; i < 2000; i++) {
      const s = sanitizeSpot({ x: pick(), y: pick(), r: pick(), dx: pick(), dy: pick(), owner: i % 3 ? 'f0' : 7 }, ids);
      if (!s) continue;
      for (const v of [s.x, s.y, s.r, s.dx, s.dy]) expect(Number.isFinite(v)).toBe(true);
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(1);
      expect(s.r).toBeGreaterThanOrEqual(0.0005);
      expect(s.r).toBeLessThanOrEqual(0.04);
      expect(Math.hypot(s.dx, s.dy)).toBeLessThanOrEqual(0.2);
      expect(s.owner === null || ids.has(s.owner)).toBe(true);
    }
  });

  it('keeps the first 100 valid spots, and none without an O size (the camera look, C §3.2)', () => {
    const raw = [{ x: NaN }, ...Array.from({ length: 105 }, (_, i) => spot(i / 105))];
    expect(sanitizeSpots(raw, ids, true)).toHaveLength(SPOT_CAP);
    expect(sanitizeSpots(raw, ids, true)[0]).toEqual(spot(0));
    expect(sanitizeSpots(raw, ids, false)).toEqual([]);
    expect(sanitizeSpots('nope', ids, true)).toEqual([]);
  });
});
```
Append to `src/edit/state.test.ts`:
```ts
describe('step 4: sanitizeEditState keeps valid spots', () => {
  it('sanitizes spots with the O size and drops them without it', () => {
    const raw = {
      v: 2,
      photo: {
        ...defaultPhoto(),
        spots: [
          { x: 0.3, y: 0.4, r: 0.02, dx: 0.05, dy: 0, owner: 'f0' },
          { x: NaN, y: 0.4, r: 0.02, dx: 0, dy: 0, owner: null },
          { x: 0.6, y: 0.4, r: 0.02, dx: 0, dy: 0, owner: 'f9' },
        ],
      },
      persons: { f0: neutralPerson() },
      template: neutralPerson(),
      primaryInit: null,
    };
    const withSize = sanitizeEditState(raw, ['f0'], { width: 1000, height: 1500 });
    expect(withSize.photo.spots).toEqual([
      { x: 0.3, y: 0.4, r: 0.02, dx: 0.05, dy: 0, owner: 'f0' },
      { x: 0.6, y: 0.4, r: 0.02, dx: 0, dy: 0, owner: null },
    ]);
    expect(sanitizeEditState(raw, ['f0']).photo.spots).toEqual([]);
  });

  it('spots are part of the output key, a detection rebase keeps them, 重置 clears them (S §5, §8.1, C §3.4)', () => {
    const e = { v: 2 as const, photo: { ...defaultPhoto(), spots: [] }, persons: { p0: neutralPerson() }, template: neutralPerson(), primaryInit: null };
    const withSpot = { ...e, photo: { ...e.photo, spots: [{ x: 0.3, y: 0.4, r: 0.02, dx: 0.05, dy: 0, owner: null }] } };
    expect(editKey(withSpot)).not.toBe(editKey(e));
    const next = assignPersons(withSpot, ['f0'], 'f0');
    expect(next.photo.spots).toEqual(withSpot.photo.spots);
    expect(resetAll(withSpot).photo.spots).toEqual([]);
  });
});
```
(Step 1's `sanitizeEditState(raw, personIds: readonly PersonId[] | null)` takes the person ids as an array (step-1 plan Task 5); `assignPersons(edit, ids: readonly PersonId[], primary, opts?)` is in `src/edit/state.ts` (step-1 plan Task 5), and so are `resetAll(edit)` (重置, step-1 plan Task 5: `{ ...edit, photo: defaultPhoto(), persons }`) and `editKey` (step-1 plan Task 4) — add whichever of them the test file's `./state` import lacks (step 1's tests already import `editKey`, `assignPersons`, `renamePersons` and `resetAll` there). `rebase` (step-1 plan Task 7) maps every stored undo state through `assignPersons`, so the `assignPersons` line is the rebase pin.)

- [x] **Step 2: Run them to see them fail**

Run: `npx vitest run src/edit/spots.test.ts src/edit/state.test.ts`
Expected: FAIL — `Failed to resolve import "./spots"`.

- [x] **Step 3: Implement**

Create `src/edit/spots.ts`:
```ts
// 祛痘 spots (skin-cleanup spec §2.3, §3.3, §5): the photo-level list, edited immutably, and its sanitizer. Pure.
// Task 13 adds the tap planning (radius, regions, snap, donor) to this module.
import { SPOT_CAP } from '../config/limits';
import type { EditState, PersonId, Selection, Spot } from '../types';

/** what 清除 removes: one person's spots (清除此人) or every spot (全部清除) */
export type ClearScope = PersonId | 'all';

/** Appends `spot`; at SPOT_CAP the state is returned unchanged (the caller shows 祛痘點已達上限). */
export function addSpot(edit: EditState, spot: Spot): EditState {
  if (edit.photo.spots.length >= SPOT_CAP) return edit;
  return { ...edit, photo: { ...edit.photo, spots: [...edit.photo.spots, spot] } };
}

/** Removes the spots of `scope`; a clear that removes nothing returns `edit` itself (no undo step). */
export function clearSpots(edit: EditState, scope: ClearScope): EditState {
  const kept = scope === 'all' ? [] : edit.photo.spots.filter((s) => s.owner !== scope);
  if (kept.length === edit.photo.spots.length) return edit;
  return { ...edit, photo: { ...edit.photo, spots: kept } };
}

export function spotsInScope(edit: EditState, scope: ClearScope): number {
  return scope === 'all' ? edit.photo.spots.length : edit.photo.spots.filter((s) => s.owner === scope).length;
}

/** 清除此人 with one person of a group photo selected; 全部清除 otherwise (fewer than 2 persons, or 全部). */
export function clearScope(sel: Selection, selectablePersons: number): ClearScope {
  return sel.kind === 'person' && selectablePersons >= 2 ? sel.id : 'all';
}

/** Owners after a person rename (C §5.2 rematch); positions never change, they are in O. */
export function remapSpotOwners(spots: readonly Spot[], rename: (id: PersonId) => PersonId | null): Spot[] {
  return spots.map((s) => (s.owner === null ? s : { ...s, owner: rename(s.owner) }));
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * One stored spot, validated (§5): non-finite → dropped; centre outside [−0.01, 1.01] → dropped, else clamped to [0, 1];
 * r clamped to [0.0005, 0.04]; a donor farther than 0.2 → fill mode; an owner not in `personIds` → null
 * (`personIds` null = the detection cache was dropped: owners are kept for the rematch).
 */
export function sanitizeSpot(raw: unknown, personIds: ReadonlySet<PersonId> | null): Spot | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (!finite(s.x) || !finite(s.y) || !finite(s.r) || !finite(s.dx) || !finite(s.dy)) return null;
  if (s.x < -0.01 || s.x > 1.01 || s.y < -0.01 || s.y > 1.01) return null;
  const far = Math.hypot(s.dx, s.dy) > 0.2;
  const owner = typeof s.owner === 'string' && (personIds === null || personIds.has(s.owner)) ? s.owner : null;
  return {
    x: Math.min(1, Math.max(0, s.x)),
    y: Math.min(1, Math.max(0, s.y)),
    r: Math.min(0.04, Math.max(0.0005, s.r)),
    dx: far ? 0 : s.dx,
    dy: far ? 0 : s.dy,
    owner,
  };
}

/** The stored list: the first SPOT_CAP valid spots; none at all without an O size (the camera look, C §3.2). */
export function sanitizeSpots(raw: unknown, personIds: ReadonlySet<PersonId> | null, hasOSize: boolean): Spot[] {
  if (!hasOSize || !Array.isArray(raw)) return [];
  const out: Spot[] = [];
  for (const r of raw) {
    if (out.length >= SPOT_CAP) break;
    const s = sanitizeSpot(r, personIds);
    if (s) out.push(s);
  }
  return out;
}
```
The sanitized photo is built by step 1's `sanitizePhoto(raw, persons: ReadonlySet<PersonId> | null, oSize?: Size | null)` (`src/edit/state.ts`; step-1 plan Task 5, step 3 added `oSize` and `sanitizeEditState(raw, personIds, oSize?)` passes it on as `sanitizePhoto(r.photo, new Set(Object.keys(persons)), oSize)`). In its `const photo: PhotoParams = { … }` literal (`r` is its raw record), set (replacing Task 1's `spots: []`):
```ts
    spots: sanitizeSpots(r.spots, persons, !!oSize),
```
and add `import { sanitizeSpots } from './spots';`. (`persons` is the set of persons the sanitized edit keeps, so an owner outside it becomes `null`; the camera look sanitizes without an O size and keeps no spots.)

- [x] **Step 4: Run the tests**

Run: `npx vitest run src/edit/spots.test.ts src/edit/state.test.ts && npm run typecheck`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/edit/spots.ts src/edit/spots.test.ts src/edit/state.ts src/edit/state.test.ts
git commit -m "v0.4 step 4 (2/20): spot list edits and sanitizer" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Tone and spot rules in the lens, renames, legacy projection and history

**Files:**
- Create: `src/edit/toneCopy.ts`
- Modify: `src/edit/lens.ts` (step 1: `applies` `:151-156`, `resetGroup` `:226-254`, `groupNeutral` / `groupHasValue` `:255-269`), `src/edit/state.ts` (step 1: `renamePersons` `:124-133`), `src/edit/legacy.ts` (step 1: `legacyProjection` `:24-40`)
- No change: `src/store/history.ts` — step 3 already hands `normalizeEntry`'s sanitizer the entry's O size (`history.ts:213`)
- Test: `src/edit/lens.test.ts`, `src/edit/state.test.ts`, `src/edit/legacy.test.ts`, `src/store/history.test.ts`

**Interfaces:**
- Consumes: Task 1 ids, Task 2 `remapSpotOwners` (and its spot sanitizer, reached through `sanitizeEditState`); step 1 `lensFor(edit, sel, persons, primary): Lens` with `get`, `set`, `applies`, `applyPreset`, `resetGroup` (C §3.3), `renamePersons(edit, map: Readonly<Record<PersonId, PersonId | null>>)` (`src/edit/state.ts`, step-1 plan Task 5; step-1 spec §5.3), `legacyProjection(edit, primary)` (C §3.2; step 1 builds its `values` as `{ ...edit.photo.values, ...person.values }`, step-1 plan Task 4), `normalizeEntry(raw)` with step 3's line `if (isEditStateRecord(r.edit)) entry.edit = sanitizeEditState(r.edit, null, { width, height });` (`history.ts:213`), `addEntry` / `getEntry` and the test helpers `entry`, `rawPut`, `validRecord` (`src/store/history.ts:29, 146`, `history.test.ts:52-99`); step 3's third `sanitizeEditState` parameter `oSize` (step-3 plan Task 3).
- Why `normalizeEntry` matters here: every stored entry passes through it on load. Without an O size, Task 2's rule (no O size = the camera look = no spots) would drop every spot of every photo on reopen. Step 3 already passes the entry's validated `{ width, height }` (C §3.2: "`oSize` is the entry's stored `width × height`"; `history.ts:213`), so the history tests below pin that behaviour and `history.ts` itself is not changed.
- Produces:
  ```ts
  // src/edit/toneCopy.ts
  export const TONE_COPY: {
    noFace: string; basic: string; recovering: string; paused: string; failed: string;
    mouthClosed: string; eyesClosed: string; spotHint: string; spotSize: string; spotCap: string;
    spotRefused: string; zoomHint: string; clearConfirm: string;
    clearAll(n: number): string; clearPerson(n: number): string; warmEnds: readonly [string, string];
  };
  // lens: applies('tone.*') → { ok: false, reason: TONE_COPY.noFace } when no person has a face;
  //       resetGroup('skin'), groupNeutral('skin') and groupHasValue('skin') also cover the 'tone' group.
  ```

- [x] **Step 1: Write the failing tests**

Append to `src/edit/lens.test.ts` (imports: `lensFor` from `./lens`; `defaultPhoto`, `neutralPerson` from `./state`; `TONE_COPY` from `./toneCopy`):
```ts
describe('step 4 tone items (skin-cleanup spec §3.1, §3.6)', () => {
  const persons = [
    { id: 'f0', face: true, body: false },
    { id: 'b0', face: false, body: true },
  ];
  const base = () => ({
    v: 2 as const,
    photo: { ...defaultPhoto(), spots: [{ x: 0.3, y: 0.3, r: 0.02, dx: 0, dy: 0, owner: 'f0' }] },
    persons: { f0: neutralPerson(), b0: neutralPerson() },
    template: neutralPerson(),
    primaryInit: null,
  });

  it('a tone edit writes the selected person, marks it 自訂 and never touches presetLink', () => {
    const e0 = base();
    const e1 = lensFor(e0, { kind: 'person', id: 'f0' }, persons, 'f0').set('tone.even', 0.6);
    expect(e1.persons.f0.values['tone.even']).toBe(0.6);
    expect(e1.persons.f0.preset).toBe('custom');
    expect(e1.photo.presetLink).toEqual(e0.photo.presetLink);
  });

  it('a person without a face refuses; under 全部 only face persons are written', () => {
    const lens = lensFor(base(), { kind: 'person', id: 'b0' }, persons, 'f0');
    expect(lens.applies('tone.darkCircle').ok).toBe(false);
    const all = lensFor(base(), { kind: 'all' }, persons, 'f0').set('tone.darkCircle', 0.8);
    expect(all.persons.f0.values['tone.darkCircle']).toBe(0.8);
    expect(all.persons.b0.values['tone.darkCircle']).toBe(0);
  });

  it('a photo without any face refuses every tone item with 未偵測到臉部，膚質工具不會套用; 磨皮 keeps its all-skin exception', () => {
    const e = { ...base(), persons: { p0: neutralPerson() } };
    const lens = lensFor(e, { kind: 'person', id: 'p0' }, [{ id: 'p0', face: false, body: false }], 'p0');
    for (const id of ['tone.even', 'tone.warmth', 'tone.darkCircle', 'tone.nasolabial', 'tone.teeth', 'tone.eyeBright'] as const) {
      expect(lens.applies(id)).toEqual({ ok: false, reason: TONE_COPY.noFace });
    }
    expect(lens.applies('skin.smooth').ok).toBe(true);
  });

  it('a beauty preset resets the tone items to neutral (§12 #31)', () => {
    const lens0 = lensFor(base(), { kind: 'person', id: 'f0' }, persons, 'f0');
    const e1 = lens0.set('tone.warmth', 0.9);
    const e2 = lensFor(e1, { kind: 'person', id: 'f0' }, persons, 'f0').applyPreset('natural', 1);
    expect(e2.persons.f0.values['tone.warmth']).toBe(0.5);
  });

  it('⊘ of the 美膚 strip resets the tone items too, and keeps the spots', () => {
    const e1 = lensFor(base(), { kind: 'person', id: 'f0' }, persons, 'f0').set('tone.teeth', 0.7);
    const e2 = lensFor(e1, { kind: 'person', id: 'f0' }, persons, 'f0').resetGroup('skin');
    expect(e2.persons.f0.values['tone.teeth']).toBe(0);
    expect(e2.photo.spots).toEqual(e1.photo.spots);
  });
});
```
Append to `src/edit/state.test.ts` (it already imports `defaultPhoto`, `neutralPerson` and `renamePersons` from `./state` — step-1 plan Task 5's tests; add any that is missing):
```ts
describe('step 4: renamePersons remaps spot owners (C §5.2)', () => {
  it('renames each owner through the map, nulls a dropped one, keeps an unmapped one', () => {
    const e = {
      v: 2 as const,
      photo: {
        ...defaultPhoto(),
        spots: [
          { x: 0.1, y: 0.1, r: 0.01, dx: 0, dy: 0, owner: 'f0' },
          { x: 0.2, y: 0.2, r: 0.01, dx: 0, dy: 0, owner: 'f1' },
          { x: 0.3, y: 0.3, r: 0.01, dx: 0, dy: 0, owner: null },
        ],
      },
      persons: { f0: neutralPerson(), f1: neutralPerson() },
      template: neutralPerson(),
      primaryInit: null,
    };
    const next = renamePersons(e, { f0: 'f3', f1: null });
    expect(next.photo.spots.map((s) => s.owner)).toEqual(['f3', null, null]);
    expect(next.photo.spots.map((s) => s.x)).toEqual([0.1, 0.2, 0.3]);
    const kept = renamePersons(e, { f1: 'f2' });
    expect(kept.photo.spots.map((s) => s.owner)).toEqual(['f0', 'f2', null]);
  });
});
```
(Step 1's `renamePersons(edit, map: Readonly<Record<PersonId, PersonId | null>>)`: null drops a person, an id absent from the map keeps its name — step-1 plan Task 5.)

Append to `src/edit/legacy.test.ts` (it imports `legacyProjection` from `./legacy`; add `defaultPhoto`, `neutralPerson` from `./state` and `neutralValue`, `paramsInGroup` to its `../engine/params` import):
```ts
describe('step 4: the legacy projection drops tone values and spots (§5 rollback)', () => {
  it('writes every tone.* value neutral into BeautyParams, and no spots', () => {
    const p = neutralPerson();
    const e = {
      v: 2 as const,
      photo: { ...defaultPhoto(), spots: [{ x: 0.5, y: 0.5, r: 0.02, dx: 0, dy: 0, owner: null }] },
      persons: { f0: { ...p, values: { ...p.values, 'tone.even': 0.7, 'tone.warmth': 0.9 } } },
      template: neutralPerson(),
      primaryInit: null,
    };
    const legacy = legacyProjection(e, 'f0');
    for (const d of paramsInGroup('tone')) expect(legacy.values[d.id], d.id).toBe(neutralValue(d));
    expect('spots' in legacy).toBe(false);
  });
});
```
In the same file, step 1's case `'round-trips 500 random sanitized v1 params'` (`legacy.test.ts:29-46`) draws a random value for every `PARAM_DEFS` id; a v1 record never holds a 膚質 value (the projection writes them neutral), so its `values:` line becomes
```ts
        values: Object.fromEntries(PARAM_DEFS.map((d) => [d.id, d.group === 'tone' ? neutralValue(d) : r()])),
```
Append to `src/store/history.test.ts` (it already stubs IndexedDB with fake-indexeddb and has the `entry()` helper):
```ts
describe('step 4: a v2 entry keeps spots and tone values (§5)', () => {
  it('round-trips edit.photo.spots and person tone values', async () => {
    const { defaultPhoto, neutralPerson } = await import('../edit/state');
    const p = neutralPerson();
    const edit = {
      v: 2 as const,
      photo: { ...defaultPhoto(), spots: [{ x: 0.25, y: 0.5, r: 0.02, dx: 0.06, dy: 0, owner: 'f0' }] },
      persons: { f0: { ...p, values: { ...p.values, 'tone.even': 0.5, 'tone.warmth': 0.3 } } },
      template: neutralPerson(),
      primaryInit: null,
    };
    const id = await addEntry({ ...entry('tone'), schema: 2, edit });
    const back = await getEntry(id);
    expect(back?.edit?.photo.spots).toEqual(edit.photo.spots);
    expect(back?.edit?.persons.f0.values['tone.warmth']).toBe(0.3);
  });

  it('loading sanitizes stored spots: a corrupt one goes, a valid one stays with its owner (kept for the rematch)', async () => {
    const { defaultPhoto, neutralPerson } = await import('../edit/state');
    const good = { x: 0.4, y: 0.4, r: 0.02, dx: 0, dy: 0, owner: 'f3' };
    await rawPut([
      {
        ...validRecord('spots', 5),
        schema: 2,
        edit: {
          v: 2,
          photo: { ...defaultPhoto(), spots: [good, { x: Infinity, y: 0, r: 0.02, dx: 0, dy: 0, owner: null }] },
          persons: { f3: neutralPerson() },
          template: neutralPerson(),
          primaryInit: null,
        },
      },
    ]);
    expect((await getEntry('spots'))?.edit?.photo.spots).toEqual([good]);
  });
});
```
(`rawPut` writes raw records through a second connection and `validRecord` is a valid v1 record of 10 × 20 px, both helpers of this file (`history.test.ts:68-99`); `normalizeEntry` passes `personIds` null, so every stored person (here `f3`) is kept and so is an owner among them, until `openState` filters them against the detection cache. `sanitizeEditState` always hands `sanitizePhoto` the set of persons it keeps, so an owner that is not a stored person becomes null even here.)

- [x] **Step 2: Run them to see them fail**

Run: `npx vitest run src/edit/lens.test.ts src/edit/state.test.ts src/edit/legacy.test.ts src/store/history.test.ts`
Expected: FAIL — `Failed to resolve import "./toneCopy"`; once that exists: the no-face reason, the ⊘ reset, the owner rename and the legacy projection (it still carries the person's `tone.*` values). Both history tests already pass: step 3 hands `normalizeEntry`'s sanitizer the entry's O size, and Task 2's spot sanitizer is in place.

- [x] **Step 3: Implement**

Create `src/edit/toneCopy.ts`:
```ts
// 膚質 copy, 繁體中文, verbatim from skin-cleanup spec §2.4 and C §2.6. Shared by the lens, the panel and the editor.
export const TONE_COPY = {
  noFace: '未偵測到臉部，膚質工具不會套用',
  basic: '基本模式不支援膚質工具',
  recovering: '臉部偵測重新啟動中，膚質工具暫不套用',
  paused: '臉部偵測暫停，膚質工具暫不套用',
  failed: '臉部偵測失敗，膚質工具暫不套用',
  mouthClosed: '嘴巴閉合時看不到牙齒，白牙效果不明顯',
  eyesClosed: '閉眼時亮眼效果不明顯',
  spotHint: '點一下痘痘或瑕疵即可去除',
  spotSize: '大小',
  spotCap: '祛痘點已達上限',
  spotRefused: '眼睛和嘴巴不適用祛痘',
  zoomHint: '放大畫面可以點得更準',
  clearConfirm: '確定清除？',
  clearAll: (n: number): string => `全部清除（${n}）`,
  clearPerson: (n: number): string => `清除此人（${n}）`,
  warmEnds: ['冷', '暖'] as const,
} as const;
```
In `src/edit/lens.ts` (step 1):
1. `applies(id)` (step-1 plan Task 6) already treats every non-body person item as a face item (`targets(id)` lists face persons only; a person without a face gets `NO_FACE_NOTE`). Only the photo-wide no-face reason differs for 膚質 — replace its line `if (!isBody(id) && noFace) return no(NO_FACE_PHOTO_NOTE);` with
   ```ts
      if (!isBody(id) && noFace) return no(paramDef(id).group === 'tone' ? TONE_COPY.noFace : NO_FACE_PHOTO_NOTE);
   ```
   (`paramDef` is already imported from `../engine/params`; add `import { TONE_COPY } from './toneCopy';`.)
2. The 美膚 strip's ⊘ and its dot cover the tone items (S §2.1 "⊘ 原圖 … including the six tone items"). Add above `lensFor`
   ```ts
   /** the defs a strip's ⊘, its no-op check and its dot cover: 美膚 also covers the six 膚質 items (skin-cleanup spec §2.1) */
   function stripDefs(group: ParamGroup): ParamDef[] {
     return group === 'skin' ? [...paramsInGroup('skin'), ...paramsInGroup('tone')] : paramsInGroup(group);
   }
   ```
   and use `stripDefs(group)` instead of `paramsInGroup(group)` in `resetGroup` (`const defs = paramsInGroup(group);`), `groupNeutral` (`for (const d of paramsInGroup(group))`) and `groupHasValue` (`return paramsInGroup(group).some(…)`). Add `ParamDef` (and `ParamGroup`, if missing) to the `../types` type import. Spots are a photo-level list outside every group, so ⊘ keeps them (the test above).

In `src/edit/state.ts`, `renamePersons` (step-1 plan Task 5) ends with
`return { ...edit, persons, photo: legsAnchor === la ? edit.photo : { ...edit.photo, legsAnchor } };` — replace that line with
```ts
  const spots = remapSpotOwners(edit.photo.spots, (id) => (id in map ? map[id] : id));
  const spotsSame = spots.every((s, i) => s.owner === edit.photo.spots[i].owner);
  if (legsAnchor === la && spotsSame) return { ...edit, persons };
  return { ...edit, persons, photo: { ...edit.photo, legsAnchor, spots: spotsSame ? edit.photo.spots : spots } };
```
(Add `remapSpotOwners` to the `./spots` import Task 2 added to `state.ts`; `spots.ts` imports only types, so there is no cycle.)

In `src/edit/legacy.ts`, step 1's `legacyProjection` builds `values: { ...edit.photo.values, ...person.values } as Record<ParamId, number>` (`legacy.ts:30`), which now carries the person's six `tone.*` values. S §5 rollback: 0.3 opens a 0.4 entry without them (a 0.3 build would ignore unknown ids anyway, but the projection is the documented v1 view; spots are not part of `BeautyParams` at all). The projection keeps every key, written neutral, so it stays a complete `BeautyParams` and step 1's round trips (`legacy.test.ts`, `lens.test.ts` 'one person p0 is v0.3', `migrate.test.ts`) still hold. Add above `legacyProjection`
```ts
/** the 0.3 view carries no 膚質 edit (skin-cleanup spec §5 rollback): the six tone.* values, neutral */
const TONE_NEUTRAL = Object.fromEntries(paramsInGroup('tone').map((d) => [d.id, neutralValue(d)]));
```
and replace that `values:` line with
```ts
    values: { ...edit.photo.values, ...person.values, ...TONE_NEUTRAL } as Record<ParamId, number>,
```
(import `neutralValue`, `paramsInGroup` from `../engine/params`; `params.ts` imports nothing from `edit/`, so there is no cycle. Every writer of `HistoryEntry.params` wraps the projection in `sanitizeParams`, which would fill a missing id with the same neutral value, so the stored record is the same as with the keys dropped.)

`src/store/history.ts` needs no change: step 3 already wrote `normalizeEntry`'s line as `if (isEditStateRecord(r.edit)) entry.edit = sanitizeEditState(r.edit, null, { width, height });` (`history.ts:213`, the entry's validated O size), which is what keeps the spots on load (skin-cleanup spec §5; C §3.2 `oSize`; step 6 relies on the same argument for its strokes).

- [x] **Step 4: Run the tests**

Run: `npx vitest run src/edit src/detect src/store && npm run typecheck`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/edit/toneCopy.ts src/edit/lens.ts src/edit/state.ts src/edit/legacy.ts src/edit/lens.test.ts src/edit/state.test.ts src/edit/legacy.test.ts src/store/history.test.ts
git commit -m "v0.4 step 4 (3/20): tone gate in the lens, ⊘ covers tone, owners follow renames, spots survive a load" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Region geometry, part 1 — face frame, gates, under-eye crescents and nasolabial bands

**Files:**
- Create: `src/engine/passes/toneGeometry.ts`
- Test: `src/engine/passes/toneGeometry.test.ts`

**Interfaces:**
- Consumes: `Face` (`src/types.ts:285-298`; pts111 indices `src/tracking/adapter111.ts:17-43`), `adapt` (`adapter111.ts:106`), the recorded face `tests/fixtures/landmarks_sample_face.json` (1000 × 1500, yaw −0.15).
- Produces (all distances iso: fractions of the image width on both axes; `aspect` = W/H; the iso point of a uv is `(x, y / aspect)`):
  ```ts
  export type V2 = [number, number];
  export type Side = 'L' | 'R';                       // image-left / image-right
  export const SIDES: readonly Side[];
  export function smoothstep(e0: number, e1: number, x: number): number;
  export function dist(a: V2, b: V2): number;
  export function centroid(ps: readonly V2[]): V2;
  export function isoPt(face: Face, i: number, aspect: number): V2;
  export interface FaceFrame { fw: number; xhat: V2; yhat: V2; eyeW: Record<Side, number>; mouthW: number }
  export function faceFrame(face: Face, aspect: number): FaceFrame;
  export function earOf(face: Face, side: Side, aspect: number): number;
  export function eyeOpen(face: Face, side: Side, aspect: number): number;   // smoothstep(0.12, 0.18, EAR)
  export function mouthOpen(face: Face, aspect: number): number;            // |P98 − P102| / mouthW
  export function teethGate(face: Face, aspect: number): number;            // smoothstep(0.01, 0.03, mouthOpen)
  export function farSide(face: Face): Side | null;
  export function sideFade(face: Face, side: Side): number;                 // far side: 1 − smoothstep(0.25, 0.5, |yaw|)
  export function resampleChain(pts: readonly V2[], n: number): V2[];
  export class Tris { tri(...): void; quad(...): void; uv(aspect: number): Float32Array }
  export function crescentGeometry(face: Face, side: Side, aspect: number): Float32Array; // x, y (uv), value triplets
  export function nasolabialGeometry(face: Face, side: Side, aspect: number): Float32Array;
  ```

- [x] **Step 1: Write the failing tests**

Create `src/engine/passes/toneGeometry.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { adapt } from '../../tracking/adapter111';
import type { Face } from '../../types';
import {
  crescentGeometry,
  dist,
  earOf,
  eyeOpen,
  faceFrame,
  farSide,
  isoPt,
  mouthOpen,
  nasolabialGeometry,
  resampleChain,
  sideFade,
  teethGate,
  type V2,
} from './toneGeometry';

const lm = JSON.parse(readFileSync(new URL('../../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as {
  width: number;
  height: number;
  points: number[];
};
const ASPECT = lm.width / lm.height;
const FACE = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);

/**
 * The same face seen in a mirror: x → 1 − x, with the image-left and image-right GPUPixel indices swapped (only the
 * indices toneGeometry and buildMaskGeometry read) and the yaw negated.
 */
function mirrorFace(f: Face): Face {
  const pairs: [number, number][] = [
    [52, 61], [53, 60], [54, 59], [55, 58], [56, 63], [57, 62], [72, 75], [73, 76], [74, 77], [82, 83],
    [84, 90], [85, 89], [86, 88], [91, 95], [92, 94], [96, 100], [97, 99], [101, 103], [104, 105],
  ];
  const map = Array.from({ length: 111 }, (_, i) => i);
  for (let i = 0; i <= 32; i++) map[i] = 32 - i;
  for (const [a, b] of pairs) {
    map[a] = b;
    map[b] = a;
  }
  const pts111 = new Float32Array(222);
  for (let i = 0; i < 111; i++) {
    pts111[i * 2] = 1 - f.pts111[map[i] * 2];
    pts111[i * 2 + 1] = f.pts111[map[i] * 2 + 1];
  }
  const ext = new Float32Array(16);
  const extMap = [0, 1, 2, 3, 4, 5, 7, 6];
  for (let i = 0; i < 8; i++) {
    ext[i * 2] = 1 - f.ext[extMap[i] * 2];
    ext[i * 2 + 1] = f.ext[extMap[i] * 2 + 1];
  }
  const n = f.oval.length / 2;
  const oval = new Float32Array(f.oval.length);
  for (let i = 0; i < n; i++) {
    oval[i * 2] = 1 - f.oval[(n - 1 - i) * 2];
    oval[i * 2 + 1] = f.oval[(n - 1 - i) * 2 + 1];
  }
  return { pts111, ext, oval, yaw: -f.yaw };
}

/** every vertex of `a`, mirrored (x → 1 − x), matches a distinct vertex of `b` within `tol` (position and value) */
function sameMirroredVertices(a: Float32Array, b: Float32Array, tol = 1e-6): boolean {
  if (a.length !== b.length) return false;
  const used = new Uint8Array(b.length / 3);
  for (let i = 0; i < a.length; i += 3) {
    const x = 1 - a[i];
    let found = -1;
    for (let j = 0; j < b.length; j += 3) {
      if (used[j / 3]) continue;
      if (Math.abs(b[j] - x) <= tol && Math.abs(b[j + 1] - a[i + 1]) <= tol && Math.abs(b[j + 2] - a[i + 2]) <= tol) {
        found = j / 3;
        break;
      }
    }
    if (found < 0) return false;
    used[found] = 1;
  }
  return true;
}

const iso = (x: number, y: number): V2 => [x, y / ASPECT];
function verts(g: Float32Array): { p: V2; v: number }[] {
  const out: { p: V2; v: number }[] = [];
  for (let i = 0; i < g.length; i += 3) out.push({ p: iso(g[i], g[i + 1]), v: g[i + 2] });
  return out;
}

/** the recorded face with the image-left eye's upper-mid point P72 placed so that EAR_L = `ear` */
function withEar(ear: number): Face {
  const f = { ...FACE, pts111: new Float32Array(FACE.pts111) };
  const fr = faceFrame(FACE, ASPECT);
  const p73 = isoPt(FACE, 73, ASPECT);
  const w = fr.eyeW.L;
  f.pts111[72 * 2] = p73[0] - fr.yhat[0] * ear * w;
  f.pts111[72 * 2 + 1] = (p73[1] - fr.yhat[1] * ear * w) * ASPECT;
  return f;
}

describe('face frame and gates (skin-cleanup spec §4.2 notation)', () => {
  it('measures the recorded face: fw ≈ 589 px, mouth open 0.042, yaw −0.15 → image-left is the far side', () => {
    const f = faceFrame(FACE, ASPECT);
    expect(f.fw * lm.width).toBeCloseTo(588.8, 0);
    expect(mouthOpen(FACE, ASPECT)).toBeCloseTo(0.0424, 3);
    expect(farSide(FACE)).toBe('L');
    expect(f.yhat[1]).toBeGreaterThan(0.9); // ŷ points to the chin (down)
    expect(Math.abs(f.xhat[0] * f.yhat[0] + f.xhat[1] * f.yhat[1])).toBeLessThan(1e-12);
  });

  it('eyeOpen, teethGate and the far-side fade are monotonic with the stated thresholds', () => {
    const opens = [0, 0.05, 0.1, 0.12, 0.15, 0.18, 0.3].map((e) => eyeOpen(withEar(e), 'L', ASPECT));
    for (let i = 1; i < opens.length; i++) expect(opens[i]).toBeGreaterThanOrEqual(opens[i - 1]);
    expect(eyeOpen(withEar(0.12), 'L', ASPECT)).toBeCloseTo(0, 6);
    expect(eyeOpen(withEar(0.18), 'L', ASPECT)).toBeCloseTo(1, 5);
    expect(earOf(withEar(0.15), 'L', ASPECT)).toBeCloseTo(0.15, 5);
    expect(teethGate(FACE, ASPECT)).toBe(1); // 0.042 > 0.03
    const fades = [0, 0.2, 0.25, 0.3, 0.4, 0.5, 0.8].map((y) => sideFade({ ...FACE, yaw: y }, 'R'));
    for (let i = 1; i < fades.length; i++) expect(fades[i]).toBeLessThanOrEqual(fades[i - 1]);
    expect(sideFade({ ...FACE, yaw: 0.5 }, 'R')).toBe(0);
    expect(sideFade({ ...FACE, yaw: 0.5 }, 'L')).toBe(1); // the near side is never faded
  });

  it('resamples a chain by arc length, endpoints included', () => {
    expect(resampleChain([[0, 0], [1, 0], [1, 2]], 4)).toEqual([[0, 0], [1, 0], [1, 1], [1, 2]]);
  });
});

describe('crescents and nasolabial bands', () => {
  it('crescent rows lie below the lower lid along ŷ, the top row ≥ 0.05 eyeW from the lid', () => {
    const fr = faceFrame(FACE, ASPECT);
    const t = (q: V2) => q[0] * fr.xhat[0] + q[1] * fr.xhat[1];
    for (const [side, chain] of [['L', [52, 57, 73, 56, 55]], ['R', [61, 62, 76, 63, 58]]] as const) {
      const lid = chain.map((i) => isoPt(FACE, i, ASPECT));
      const w = fr.eyeW[side];
      let checked = 0;
      for (const { p } of verts(crescentGeometry(FACE, side, ASPECT))) {
        const tp = t(p);
        for (let i = 0; i + 1 < lid.length; i++) {
          const a = lid[i];
          const b = lid[i + 1];
          if (tp < Math.min(t(a), t(b)) - 1e-12 || tp > Math.max(t(a), t(b)) + 1e-12 || t(a) === t(b)) continue;
          const f = (tp - t(a)) / (t(b) - t(a));
          const q: V2 = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
          expect((p[0] - q[0]) * fr.yhat[0] + (p[1] - q[1]) * fr.yhat[1]).toBeGreaterThanOrEqual(0.05 * w);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(30);
    }
  });

  it('each nasolabial band lies inside the box of P(82|83) and P(84|90) grown by 0.1 fw', () => {
    const fw = faceFrame(FACE, ASPECT).fw;
    for (const [side, a, b] of [['L', 82, 84], ['R', 83, 90]] as const) {
      const pa = isoPt(FACE, a, ASPECT);
      const pb = isoPt(FACE, b, ASPECT);
      for (const { p } of verts(nasolabialGeometry(FACE, side, ASPECT))) {
        expect(p[0]).toBeGreaterThanOrEqual(Math.min(pa[0], pb[0]) - 0.1 * fw);
        expect(p[0]).toBeLessThanOrEqual(Math.max(pa[0], pb[0]) + 0.1 * fw);
        expect(p[1]).toBeGreaterThanOrEqual(Math.min(pa[1], pb[1]) - 0.1 * fw);
        expect(p[1]).toBeLessThanOrEqual(Math.max(pa[1], pb[1]) + 0.1 * fw);
      }
    }
  });

  it('the mirrored face gives the mirrored geometry within 1e-6', () => {
    const m = mirrorFace(FACE);
    expect(sameMirroredVertices(crescentGeometry(FACE, 'L', ASPECT), crescentGeometry(m, 'R', ASPECT))).toBe(true);
    expect(sameMirroredVertices(crescentGeometry(FACE, 'R', ASPECT), crescentGeometry(m, 'L', ASPECT))).toBe(true);
    expect(sameMirroredVertices(nasolabialGeometry(FACE, 'L', ASPECT), nasolabialGeometry(m, 'R', ASPECT))).toBe(true);
  });

  it('a degenerate face (all points equal) gives finite, zero-area output', () => {
    const d: Face = { pts111: new Float32Array(222).fill(0.5), ext: new Float32Array(16).fill(0.5), oval: new Float32Array(72).fill(0.5), yaw: 0 };
    for (const g of [crescentGeometry(d, 'L', ASPECT), nasolabialGeometry(d, 'R', ASPECT)]) {
      for (const v of g) expect(Number.isFinite(v)).toBe(true);
      const vs = verts(g);
      for (let i = 0; i < vs.length; i += 3) {
        const [a, b, c] = [vs[i].p, vs[i + 1].p, vs[i + 2].p];
        expect(Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))).toBeLessThan(1e-12);
      }
    }
    expect(eyeOpen(d, 'L', ASPECT)).toBe(0);
    expect(dist([0, 0], [3, 4])).toBe(5);
  });
});
```

- [x] **Step 2: Run them to see them fail**

Run: `npx vitest run src/engine/passes/toneGeometry.test.ts`
Expected: FAIL — `Failed to resolve import "./toneGeometry"`.

- [x] **Step 3: Implement**

Create `src/engine/passes/toneGeometry.ts`:
```ts
// 膚質 region geometry (skin-cleanup spec §4.2): O-space triangle lists (x, y, value) for the ¼-res targets R and Q,
// built from one adapted face, plus the gates folded into each region's strength. Pure, no GL; toneMask.ts draws them.
// Every distance is iso (fractions of the image width on both axes, as mask.ts:70): the iso point of a uv is
// (x, y / aspect). pts111 indices follow src/tracking/adapter111.ts; image-left = GPUPixel left. Original work.
import type { Face } from '../../types';

export type V2 = [number, number];
/** image-left / image-right half of the face */
export type Side = 'L' | 'R';
export const SIDES: readonly Side[] = ['L', 'R'];

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

const add = (a: V2, b: V2): V2 => [a[0] + b[0], a[1] + b[1]];
const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const mul = (a: V2, k: number): V2 => [a[0] * k, a[1] * k];
const dot = (a: V2, b: V2): number => a[0] * b[0] + a[1] * b[1];
export const dist = (a: V2, b: V2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
function unit(a: V2): V2 {
  const l = Math.hypot(a[0], a[1]);
  return l > 1e-12 ? [a[0] / l, a[1] / l] : [0, 0];
}
export function centroid(ps: readonly V2[]): V2 {
  let x = 0;
  let y = 0;
  for (const p of ps) {
    x += p[0];
    y += p[1];
  }
  return ps.length ? [x / ps.length, y / ps.length] : [0, 0];
}

export function isoPt(face: Face, i: number, aspect: number): V2 {
  return [face.pts111[i * 2], face.pts111[i * 2 + 1] / aspect];
}

export interface FaceFrame {
  /** iso face width |P(0) − P(32)| (mask.ts:94) */
  fw: number;
  /** unit vector between the eye centres, P(74) → P(77) */
  xhat: V2;
  /** x̂ turned +90°, negated when needed so it points to the chin (ext[4], the menton) */
  yhat: V2;
  /** |P(52) − P(55)|, |P(58) − P(61)| */
  eyeW: Record<Side, number>;
  /** |P(84) − P(90)| */
  mouthW: number;
}

export function faceFrame(face: Face, aspect: number): FaceFrame {
  const P = (i: number) => isoPt(face, i, aspect);
  const xhat = unit(sub(P(77), P(74)));
  let yhat: V2 = [-xhat[1], xhat[0]];
  const menton: V2 = [face.ext[8], face.ext[9] / aspect];
  if (dot(yhat, sub(menton, P(46))) < 0) yhat = [-yhat[0], -yhat[1]];
  return { fw: dist(P(0), P(32)), xhat, yhat, eyeW: { L: dist(P(52), P(55)), R: dist(P(58), P(61)) }, mouthW: dist(P(84), P(90)) };
}

/** eye aspect ratio: |P72 − P73| / eyeW_L (image-right: P75, P76, eyeW_R) */
export function earOf(face: Face, side: Side, aspect: number): number {
  const w = faceFrame(face, aspect).eyeW[side];
  const [a, b] = side === 'L' ? [72, 73] : [75, 76];
  return w > 1e-12 ? dist(isoPt(face, a, aspect), isoPt(face, b, aspect)) / w : 0;
}

/** 亮眼's per-eye gate (step 5's blink gate reuses it, C §4.4) */
export function eyeOpen(face: Face, side: Side, aspect: number): number {
  return smoothstep(0.12, 0.18, earOf(face, side, aspect));
}

/** |P98 − P102| / mouthW */
export function mouthOpen(face: Face, aspect: number): number {
  const w = faceFrame(face, aspect).mouthW;
  return w > 1e-12 ? dist(isoPt(face, 98, aspect), isoPt(face, 102, aspect)) / w : 0;
}

/** 白牙's gate: smoothstep(0.01, 0.03, mouthOpen) */
export function teethGate(face: Face, aspect: number): number {
  return smoothstep(0.01, 0.03, mouthOpen(face, aspect));
}

/** the side whose eye is nearer to the nose tip: image-right when yaw > 0 (adapter111.ts:92-103) */
export function farSide(face: Face): Side | null {
  return face.yaw > 0 ? 'R' : face.yaw < 0 ? 'L' : null;
}

/** far-side regions × (1 − smoothstep(0.25, 0.50, |yaw|)); the near side is never faded */
export function sideFade(face: Face, side: Side): number {
  return farSide(face) === side ? 1 - smoothstep(0.25, 0.5, Math.abs(face.yaw)) : 1;
}

/** `n` points along the polyline, equally spaced by arc length, endpoints included */
export function resampleChain(pts: readonly V2[], n: number): V2[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i], pts[i - 1]));
  const total = cum[cum.length - 1];
  const out: V2[] = [];
  let seg = 0;
  for (let k = 0; k < n; k++) {
    const t = n > 1 ? (total * k) / (n - 1) : 0;
    while (seg < pts.length - 2 && cum[seg + 1] < t) seg++;
    const l = cum[seg + 1] - cum[seg];
    const f = l > 0 ? Math.min(1, Math.max(0, (t - cum[seg]) / l)) : 0;
    out.push(add(pts[seg], mul(sub(pts[seg + 1], pts[seg]), f)));
  }
  return out;
}

/** a triangle list collected in iso space and emitted as O-normalized (x, y, value) triplets */
export class Tris {
  private readonly v: number[] = [];
  tri(a: V2, av: number, b: V2, bv: number, c: V2, cv: number): void {
    this.v.push(a[0], a[1], av, b[0], b[1], bv, c[0], c[1], cv);
  }
  /** a, b, c, d in order around the quad */
  quad(a: V2, av: number, b: V2, bv: number, c: V2, cv: number, d: V2, dv: number): void {
    this.tri(a, av, b, bv, c, cv);
    this.tri(a, av, c, cv, d, dv);
  }
  uv(aspect: number): Float32Array {
    const out = new Float32Array(this.v);
    for (let i = 1; i < out.length; i += 3) out[i] *= aspect;
    return out;
  }
}

const LOWER_LID: Record<Side, readonly number[]> = { L: [52, 57, 73, 56, 55], R: [61, 62, 76, 63, 58] };

/**
 * 黑眼圈 crescent (R.R): the lower-lid chain resampled to 7 points (t = 0…1, τ = sin πt) and three rows along ŷ at
 * 0.06·eyeW (value 0), (0.06 + 0.12τ)·eyeW (value τ) and (0.06 + 0.40τ)·eyeW (value 0): it tapers to nothing at the eye
 * corners and leaves the lashes alone.
 */
export function crescentGeometry(face: Face, side: Side, aspect: number): Float32Array {
  const f = faceFrame(face, aspect);
  const chain = resampleChain(LOWER_LID[side].map((i) => isoPt(face, i, aspect)), 7);
  const w = f.eyeW[side];
  const r0: V2[] = [];
  const r1: V2[] = [];
  const r2: V2[] = [];
  const val: number[] = [];
  for (let i = 0; i < 7; i++) {
    const tau = Math.sin((Math.PI * i) / 6);
    r0.push(add(chain[i], mul(f.yhat, 0.06 * w)));
    r1.push(add(chain[i], mul(f.yhat, (0.06 + 0.12 * tau) * w)));
    r2.push(add(chain[i], mul(f.yhat, (0.06 + 0.4 * tau) * w)));
    val.push(tau);
  }
  const t = new Tris();
  for (let i = 0; i < 6; i++) {
    t.quad(r0[i], 0, r0[i + 1], 0, r1[i + 1], val[i + 1], r1[i], val[i]);
    t.quad(r1[i], val[i], r1[i + 1], val[i + 1], r2[i + 1], 0, r2[i], 0);
  }
  return t.uv(aspect);
}

/**
 * 法令紋 band (R.G), per side with o = −x̂ (image-left) or +x̂: S = P(82|83) + 0.04fw·o − 0.01fw·ŷ,
 * E = P(84|90) + 0.06fw·o + 0.05fw·ŷ, control C = (S + E)/2 + 0.035fw·o; a quadratic Bézier with 9 samples, half-width
 * h(t) = 0.035fw·(0.6 + 0.4 sin πt), rows −h (0), centre (1 × smoothstep over the first and last 15 %), +h (0).
 */
export function nasolabialGeometry(face: Face, side: Side, aspect: number): Float32Array {
  const f = faceFrame(face, aspect);
  const P = (i: number) => isoPt(face, i, aspect);
  const o: V2 = side === 'L' ? mul(f.xhat, -1) : f.xhat;
  const [ia, ib] = side === 'L' ? [82, 84] : [83, 90];
  const S = add(add(P(ia), mul(o, 0.04 * f.fw)), mul(f.yhat, -0.01 * f.fw));
  const E = add(add(P(ib), mul(o, 0.06 * f.fw)), mul(f.yhat, 0.05 * f.fw));
  const C = add(mul(add(S, E), 0.5), mul(o, 0.035 * f.fw));
  const lo: V2[] = [];
  const mid: V2[] = [];
  const hi: V2[] = [];
  const val: number[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const u = 1 - t;
    const p = add(add(mul(S, u * u), mul(C, 2 * u * t)), mul(E, t * t));
    const tan = add(mul(sub(C, S), 2 * u), mul(sub(E, C), 2 * t));
    const n = unit([-tan[1], tan[0]]);
    const h = 0.035 * f.fw * (0.6 + 0.4 * Math.sin(Math.PI * t));
    lo.push(add(p, mul(n, -h)));
    mid.push(p);
    hi.push(add(p, mul(n, h)));
    val.push(smoothstep(0, 0.15, t) * (1 - smoothstep(0.85, 1, t)));
  }
  const tr = new Tris();
  for (let i = 0; i < 8; i++) {
    tr.quad(lo[i], 0, lo[i + 1], 0, mid[i + 1], val[i + 1], mid[i], val[i]);
    tr.quad(mid[i], val[i], mid[i + 1], val[i + 1], hi[i + 1], 0, hi[i], 0);
  }
  return tr.uv(aspect);
}
```

- [x] **Step 4: Run the tests**

Run: `npx vitest run src/engine/passes/toneGeometry.test.ts && npm run typecheck`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/engine/passes/toneGeometry.ts src/engine/passes/toneGeometry.test.ts
git commit -m "v0.4 step 4 (4/20): tone region geometry — gates, crescents, nasolabial bands" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Region geometry, part 2 — mouth and eye fans, the skin and 膚色 regions, the R and Q draw lists

**Files:**
- Modify: `src/engine/passes/toneGeometry.ts`
- Modify: `src/engine/passes/mask.ts:81, 118` (CRLF; `buildMaskGeometry` gains an optional ring width)
- Test: `src/engine/passes/toneGeometry.test.ts`, `src/engine/passes/mask.test.ts`

**Interfaces:**
- Consumes: Task 4's helpers; `buildMaskGeometry(face, aspect, out)` whose first two returned numbers are `count` and `base` (fans + rings first, holes after; step 1 keeps that meaning and adds a third, `fanEnd`: it returns `[count, base, fanEnd]`, step-1 spec §4.2), `MASK_MAX_FLOATS`, `MASK_FEATHER.ring` (`mask.ts:39-46, 152`); step 1's per-face influence cap (centre `c_f` in UV, `cap_f` iso, −1 = none; step-1 spec §4.1 item 3, face-table texel 73).
- Produces:
  ```ts
  // mask.ts
  export function buildMaskGeometry(face: Face, aspect: number, out: Float32Array, ringIso?: number): /* unchanged tuple */;
  // toneGeometry.ts
  export const TONE_ZERO: number;                       // 128 / 255
  export type Win = readonly [number, number, number, number];
  export const IDENTITY_WIN: Win;
  export type Rgba = readonly [number, number, number, number];
  export type ChannelMask = readonly [boolean, boolean, boolean, boolean];
  export const R_CLEAR: Rgba;                           // [0, 0, 0, 0]
  export const Q_CLEAR: Rgba;                           // [0, 0, TONE_ZERO, 0]
  export interface ToneValues { even: number; warmth: number; darkCircle: number; nasolabial: number; teeth: number; eyeBright: number }
  export const NEUTRAL_TONE: ToneValues;
  export function toneValuesOf(v: Readonly<Partial<Record<ParamId, number>>>): ToneValues;
  export function fieldActive(t: ToneValues): boolean;  // 勻膚, 膚色, 黑眼圈 or 法令紋 not neutral
  export function toneActive(t: ToneValues): boolean;   // any of the six not neutral
  export interface ToneCap { c: V2; r: number }         // centre (UV), cap radius (iso), r < 0 = none
  export interface ToneFaceInput { face: Face; values: ToneValues; weight: number; cap: ToneCap | null }
  export interface ToneDraw { phase: 0 | 1 | 2 | 3; blend: 'max' | 'min'; mask: ChannelMask; off: Rgba; str: Rgba; verts: Float32Array }
  export function mouthGeometry(face: Face, aspect: number): Float32Array;
  export function eyeGeometry(face: Face, side: Side, aspect: number): Float32Array;
  export function warmRingWidth(face: Face, aspect: number, cap: ToneCap | null): number; // iso
  export function toneDrawsR(faces: readonly ToneFaceInput[], aspect: number): ToneDraw[];
  export function toneDrawsQ(faces: readonly ToneFaceInput[], aspect: number): ToneDraw[];
  ```
  A draw writes `off + str · smoothstep(0, 1, value)` through its channel `mask` with blend equation `blend`; draws run in ascending `phase`, then in list order. (This is S §4.2's shader `uStr · smoothstep(…)`, and for Q.B `0.5 + 0.5·uWarm·smoothstep(…)`, with the neutral point stored as `TONE_ZERO` = 128/255 so it decodes to exactly 0.)

- [x] **Step 1: Write the failing tests**

Add inside the existing `describe('buildMaskGeometry')` of `src/engine/passes/mask.test.ts`:
```ts
  it('an explicit ring width moves the ring vertices that far out (膚色 wide ring, skin-cleanup spec §4.2)', () => {
    const out = new Float32Array(MASK_MAX_FLOATS);
    const [, base] = buildMaskGeometry(face(), 1, out, 0.12);
    let minRing = Infinity;
    for (let v = 0; v < base; v++) if (out[v * 3 + 2] === 0) minRing = Math.min(minRing, Math.hypot(out[v * 3] - 0.5, out[v * 3 + 1] - 0.47));
    expect(minRing).toBeGreaterThan(0.21 + 0.12 * 0.99);
  });
```
Append to `src/engine/passes/toneGeometry.test.ts` (add the new names to its import from `./toneGeometry`: `eyeGeometry`, `mouthGeometry`, `NEUTRAL_TONE`, `toneDrawsQ`, `toneDrawsR`, `toneValuesOf`, `TONE_ZERO`, `warmRingWidth`, `type ToneFaceInput`):
```ts
const area2 = (a: V2, b: V2, c: V2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function triangles(g: Float32Array): { a: V2; b: V2; c: V2; v: number[] }[] {
  const out: { a: V2; b: V2; c: V2; v: number[] }[] = [];
  for (let i = 0; i < g.length; i += 9) out.push({ a: iso(g[i], g[i + 1]), b: iso(g[i + 3], g[i + 4]), c: iso(g[i + 6], g[i + 7]), v: [g[i + 2], g[i + 5], g[i + 8]] });
  return out;
}
/** every triangle has a non-zero area and they all share one orientation (nothing folds) */
function noFold(g: Float32Array): boolean {
  const s = triangles(g).map((t) => area2(t.a, t.b, t.c));
  return s.every((x) => Math.abs(x) > 1e-14) && (s.every((x) => x > 0) || s.every((x) => x < 0));
}
/** the recorded face with the image-left eye squeezed to EAR `ear` and the inner lips closed to mouthOpen `open` */
function squint(ear: number, open: number): Face {
  const f = { ...FACE, pts111: new Float32Array(FACE.pts111) };
  const fr = faceFrame(FACE, ASPECT);
  const squeeze = (ids: number[], centre: V2, k: number) => {
    for (const i of ids) {
      const p = isoPt(FACE, i, ASPECT);
      const along = (p[0] - centre[0]) * fr.yhat[0] + (p[1] - centre[1]) * fr.yhat[1];
      f.pts111[i * 2] = p[0] - fr.yhat[0] * along * (1 - k);
      f.pts111[i * 2 + 1] = (p[1] - fr.yhat[1] * along * (1 - k)) * ASPECT;
    }
  };
  squeeze([53, 72, 54, 56, 73, 57], isoPt(FACE, 74, ASPECT), ear / earOf(FACE, 'L', ASPECT));
  const a = isoPt(FACE, 98, ASPECT);
  const b = isoPt(FACE, 102, ASPECT);
  squeeze([97, 98, 99, 101, 102, 103], [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], open / mouthOpen(FACE, ASPECT));
  return f;
}

describe('mouth and eye fans', () => {
  it('the value-1 area of the mouth equals the inner-lip polygon within 1 %', () => {
    const poly = [96, 97, 98, 99, 100, 101, 102, 103].map((i) => isoPt(FACE, i, ASPECT));
    let shoelace = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      shoelace += p[0] * q[1] - q[0] * p[1];
    }
    const polyArea = Math.abs(shoelace) / 2;
    const fan = triangles(mouthGeometry(FACE, ASPECT)).filter((t) => t.v.every((v) => v === 1));
    const fanArea = fan.reduce((s, t) => s + Math.abs(area2(t.a, t.b, t.c)) / 2, 0);
    expect(Math.abs(fanArea - polyArea) / polyArea).toBeLessThan(0.01);
  });

  it('a squint (EAR 0.15) and an almost closed mouth (0.01) still give positive-area, unfolded triangles', () => {
    const f = squint(0.15, 0.01);
    expect(earOf(f, 'L', ASPECT)).toBeCloseTo(0.15, 2);
    expect(mouthOpen(f, ASPECT)).toBeCloseTo(0.01, 2);
    expect(noFold(eyeGeometry(f, 'L', ASPECT))).toBe(true);
    expect(noFold(mouthGeometry(f, ASPECT))).toBe(true);
    expect(noFold(eyeGeometry(FACE, 'R', ASPECT))).toBe(true);
  });

  it('the mirrored face gives the mirrored fans', () => {
    const m = mirrorFace(FACE);
    expect(sameMirroredVertices(eyeGeometry(FACE, 'L', ASPECT), eyeGeometry(m, 'R', ASPECT))).toBe(true);
    expect(sameMirroredVertices(mouthGeometry(FACE, ASPECT), mouthGeometry(m, ASPECT))).toBe(true);
  });
});

describe('膚色 ring width w_T', () => {
  const fw = faceFrame(FACE, ASPECT).fw;
  const ovalIso = (): V2[] => Array.from({ length: FACE.oval.length / 2 }, (_, i): V2 => [FACE.oval[i * 2], FACE.oval[i * 2 + 1] / ASPECT]);
  const boxCentre = (): V2 => {
    const xs = ovalIso().map((p) => p[0]);
    const ys = ovalIso().map((p) => p[1] * ASPECT);
    return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  };

  it('is 0.30 fw for a lone face (no cap, or cap −1)', () => {
    expect(warmRingWidth(FACE, ASPECT, null)).toBeCloseTo(0.3 * fw, 12);
    expect(warmRingWidth(FACE, ASPECT, { c: [0.5, 0.5], r: -1 })).toBeCloseTo(0.3 * fw, 12);
  });

  it('shrinks toward 0.08 fw as a neighbour comes close, and never passes the midpoint when there is room', () => {
    const c = boxCentre();
    const cIso: V2 = [c[0], c[1] / ASPECT];
    const rOval = Math.max(...ovalIso().map((p) => dist(p, cIso)));
    let prev = Infinity;
    for (const gapFw of [3, 2.5, 2, 1.6, 1.3, 1.1]) {
      const cap = { c, r: (gapFw * fw) / 2 };
      const w = warmRingWidth(FACE, ASPECT, cap);
      expect(w).toBeLessThanOrEqual(prev + 1e-12);
      expect(w).toBeGreaterThanOrEqual(0.08 * fw - 1e-12);
      if (cap.r - rOval >= 0.08 * fw) expect(rOval + w).toBeLessThanOrEqual(cap.r + 1e-12);
      prev = w;
    }
  });
});

describe('R and Q draw lists', () => {
  const one = (values = NEUTRAL_TONE, face = FACE): ToneFaceInput[] => [{ face, values, weight: 1, cap: null }];

  it('neutral values draw nothing into R; Q always carries the skin coverage (G = 1)', () => {
    expect(toneDrawsR(one(), ASPECT)).toEqual([]);
    expect(toneDrawsQ(one(), ASPECT).map((d) => [d.phase, d.blend, d.str[1]])).toEqual([
      [0, 'max', 1],
      [1, 'min', 1],
    ]);
  });

  it('each tool writes only its own R channel, scaled by its gates', () => {
    const v = { ...NEUTRAL_TONE, darkCircle: 1, nasolabial: 1, teeth: 1, eyeBright: 1 };
    const draws = toneDrawsR(one(v), ASPECT);
    for (const d of draws) {
      expect(d.blend).toBe('max');
      expect(d.str.filter((s) => s > 0)).toHaveLength(1);
    }
    expect(Math.max(...draws.map((d) => d.str[2]))).toBe(1); // 白牙: mouth open 0.042 → gate 1; |yaw| < 0.25 → no fade
    const closed = toneDrawsR(one(v, squint(0.1, 0.005)), ASPECT);
    expect(closed.some((d) => d.str[2] > 0)).toBe(false); // 白牙 off on a closed mouth
    expect(closed.filter((d) => d.str[3] > 0)).toHaveLength(1); // 亮眼 only on the open image-right eye
  });

  it('膚色: a warm face draws MAX, then MIN holes into B around TONE_ZERO; a cool face the opposite', () => {
    const warm = toneDrawsQ(one({ ...NEUTRAL_TONE, warmth: 1 }), ASPECT).filter((d) => d.mask[2]);
    expect(warm.map((d) => [d.phase, d.blend, d.off[2], d.str[2]])).toEqual([
      [2, 'max', TONE_ZERO, 0.5],
      [3, 'min', TONE_ZERO, 0.5],
    ]);
    const cool = toneDrawsQ(one({ ...NEUTRAL_TONE, warmth: 0 }), ASPECT).filter((d) => d.mask[2]);
    expect(cool.map((d) => [d.blend, d.str[2]])).toEqual([
      ['min', -0.5],
      ['max', -0.5],
    ]);
  });

  it('reads PersonParams values, turning junk into neutral and clamping to 0..1', () => {
    expect(toneValuesOf({ 'tone.even': 0.4, 'tone.warmth': Number.NaN, 'tone.teeth': 7 })).toEqual({ ...NEUTRAL_TONE, even: 0.4, teeth: 1 });
  });
});
```

- [x] **Step 2: Run them to see them fail**

Run: `npx vitest run src/engine/passes/toneGeometry.test.ts src/engine/passes/mask.test.ts`
Expected: FAIL — `mouthGeometry is not a function` (missing exports) and the ring-width test (the fourth argument is ignored).

- [x] **Step 3: Implement**

`src/engine/passes/mask.ts` (CRLF) — line 81 gains the parameter and line 118 uses it:
```ts
export function buildMaskGeometry(face: Face, aspect: number, out: Float32Array, ringIso?: number): [number, number, number] {
```
(step 1's return type, `[vertexCount, base, fanEnd]`, is unchanged), and
```ts
  const ring = ringIso ?? MASK_FEATHER.ring * faceW;
```
Add to the function's doc comment: "`ringIso`: the outer ring's width in iso units (default `MASK_FEATHER.ring · fw`; 膚色 passes w_T, skin-cleanup spec §4.2)."

`src/engine/passes/toneGeometry.ts` — extend the imports at the top:
```ts
import type { Face, ParamId } from '../../types';
import { buildMaskGeometry, MASK_MAX_FLOATS } from './mask';
```
and append:
```ts
/** 8-bit zero point of the signed targets Q.B and Δ8: 128/255 is stored exactly, so neutral decodes to exactly 0 */
export const TONE_ZERO = 128 / 255;

/** O-normalized rectangle a target covers: x, y, w, h (the preview covers the whole O) */
export type Win = readonly [number, number, number, number];
export const IDENTITY_WIN: Win = [0, 0, 1, 1];
export type Rgba = readonly [number, number, number, number];
export type ChannelMask = readonly [boolean, boolean, boolean, boolean];
export const R_CLEAR: Rgba = [0, 0, 0, 0];
export const Q_CLEAR: Rgba = [0, 0, TONE_ZERO, 0];

export interface ToneValues {
  even: number;
  /** 0..1, 0.5 neutral (−50 冷 … +50 暖) */
  warmth: number;
  darkCircle: number;
  nasolabial: number;
  teeth: number;
  eyeBright: number;
}
export const NEUTRAL_TONE: ToneValues = { even: 0, warmth: 0.5, darkCircle: 0, nasolabial: 0, teeth: 0, eyeBright: 0 };

const v01 = (v: number | undefined, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);
export function toneValuesOf(v: Readonly<Partial<Record<ParamId, number>>>): ToneValues {
  return {
    even: v01(v['tone.even'], 0),
    warmth: v01(v['tone.warmth'], 0.5),
    darkCircle: v01(v['tone.darkCircle'], 0),
    nasolabial: v01(v['tone.nasolabial'], 0),
    teeth: v01(v['tone.teeth'], 0),
    eyeBright: v01(v['tone.eyeBright'], 0),
  };
}
/** the items the tone field P0c serves (S §4.1: 勻膚, 膚色, 黑眼圈 or 法令紋) */
export function fieldActive(t: ToneValues): boolean {
  return t.even > 0 || t.warmth !== 0.5 || t.darkCircle > 0 || t.nasolabial > 0;
}
export function toneActive(t: ToneValues): boolean {
  return fieldActive(t) || t.teeth > 0 || t.eyeBright > 0;
}

/** step 1's influence cap of one face (face-table texel 73): centre in UV, radius iso; r < 0 = no cap */
export interface ToneCap {
  c: V2;
  r: number;
}
export interface ToneFaceInput {
  face: Face;
  values: ToneValues;
  /** RenderFace.weight (1 in the editor) */
  weight: number;
  cap: ToneCap | null;
}
/** one draw into R or Q: writes off + str · smoothstep(0, 1, value) through `mask` with blend equation `blend` */
export interface ToneDraw {
  /** draws run in ascending phase, then in list order */
  phase: 0 | 1 | 2 | 3;
  blend: 'max' | 'min';
  mask: ChannelMask;
  off: Rgba;
  str: Rgba;
  /** x, y (O-normalized uv), value — a triangle list */
  verts: Float32Array;
}

/** `p` moved by `d` along the ray from `c` (d < 0: toward c) */
const away = (p: V2, c: V2, d: number): V2 => add(p, mul(unit(sub(p, c)), d));

const INNER_LIP = [96, 97, 98, 99, 100, 101, 102, 103];
const EYE_RING: Record<Side, readonly number[]> = { L: [52, 53, 72, 54, 55, 56, 73, 57], R: [58, 59, 75, 60, 61, 62, 76, 63] };

/** 白牙 (R.B): 1 on the inner-lip polygon (a fan from its centroid), falling to 0 over an outward ring of 0.04·mouthW */
export function mouthGeometry(face: Face, aspect: number): Float32Array {
  const f = faceFrame(face, aspect);
  const poly = INNER_LIP.map((i) => isoPt(face, i, aspect));
  const c = centroid(poly);
  const outer = poly.map((p) => away(p, c, 0.04 * f.mouthW));
  const t = new Tris();
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    t.tri(c, 1, poly[i], 1, poly[j], 1);
    t.quad(poly[i], 1, poly[j], 1, outer[j], 0, outer[i], 0);
  }
  return t.uv(aspect);
}

/**
 * 亮眼 (R.A): each eye-ring point moved toward the eye centroid c — value 0 at an inset of min(0.04·eyeW, 0.25|c − p|),
 * value 1 at min(0.12·eyeW, 0.5|c − p|), a fan of 1 inside. The capped insets never cross the centroid (S §4.2), and
 * the lid skin stays out.
 */
export function eyeGeometry(face: Face, side: Side, aspect: number): Float32Array {
  const w = faceFrame(face, aspect).eyeW[side];
  const ring = EYE_RING[side].map((i) => isoPt(face, i, aspect));
  const c = centroid(ring);
  const a = ring.map((p) => away(p, c, -Math.min(0.04 * w, 0.25 * dist(c, p))));
  const b = ring.map((p) => away(p, c, -Math.min(0.12 * w, 0.5 * dist(c, p))));
  const t = new Tris();
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    t.tri(c, 1, b[i], 1, b[j], 1);
    t.quad(a[i], 0, a[j], 0, b[j], 1, b[i], 1);
  }
  return t.uv(aspect);
}

/**
 * Width w_T of 膚色's outer ring: 0.30 fw without a cap; otherwise clamp(cap − r_oval, 0.08 fw, 0.30 fw), r_oval being
 * the largest iso distance from the cap centre to an oval point, so the ring stops about halfway to the next face.
 */
export function warmRingWidth(face: Face, aspect: number, cap: ToneCap | null): number {
  const fw = faceFrame(face, aspect).fw;
  if (!cap || !(cap.r >= 0)) return 0.3 * fw;
  const c: V2 = [cap.c[0], cap.c[1] / aspect];
  let rOval = 0;
  for (let i = 0; i < face.oval.length; i += 2) rOval = Math.max(rOval, dist(c, [face.oval[i], face.oval[i + 1] / aspect]));
  return Math.min(0.3 * fw, Math.max(0.08 * fw, cap.r - rOval));
}

const ALL: ChannelMask = [true, true, true, true];
const RG: ChannelMask = [true, true, false, false];
const BLUE: ChannelMask = [false, false, true, false];
const NONE4: Rgba = [0, 0, 0, 0];

/** R: R 黑眼圈 · G 法令紋 · B 白牙 · A 亮眼, every region MAX (overlaps keep the strongest face); zero strengths are skipped */
export function toneDrawsR(faces: readonly ToneFaceInput[], aspect: number): ToneDraw[] {
  const out: ToneDraw[] = [];
  const put = (str: Rgba, geometry: () => Float32Array) => {
    if (str[0] > 0 || str[1] > 0 || str[2] > 0 || str[3] > 0) out.push({ phase: 0, blend: 'max', mask: ALL, off: NONE4, str, verts: geometry() });
  };
  for (const { face, values: v, weight } of faces) {
    const w = weight > 0 ? Math.min(1, weight) : 0;
    if (w === 0) continue;
    for (const side of SIDES) {
      const fade = sideFade(face, side);
      put([w * v.darkCircle * fade, 0, 0, 0], () => crescentGeometry(face, side, aspect));
      put([0, w * v.nasolabial * fade, 0, 0], () => nasolabialGeometry(face, side, aspect));
      put([0, 0, 0, w * v.eyeBright * eyeOpen(face, side, aspect) * fade], () => eyeGeometry(face, side, aspect));
    }
    put([0, 0, w * v.teeth * teethGate(face, aspect), 0], () => mouthGeometry(face, aspect));
  }
  return out;
}

/**
 * Q: R 勻膚 strength · G skin coverage · B 膚色 around TONE_ZERO. Skin (as 磨皮): oval + 8 % fw ring MAX (phase 0), eye and
 * mouth holes MIN (phase 1), channels R and G. 膚色: oval + w_T ring and the same holes, channel B; a warm face draws MAX
 * then MIN holes, a cool face MIN then MAX holes, so a hole pulls toward neutral from either side (phases 2, 3).
 */
export function toneDrawsQ(faces: readonly ToneFaceInput[], aspect: number): ToneDraw[] {
  const out: ToneDraw[] = [];
  const buf = new Float32Array(MASK_MAX_FLOATS);
  const parts = (face: Face, ringIso?: number) => {
    const [count, base] = buildMaskGeometry(face, aspect, buf, ringIso);
    return { base: buf.slice(0, base * 3), holes: buf.slice(base * 3, count * 3) };
  };
  for (const { face, values: v, weight, cap } of faces) {
    const w = weight > 0 ? Math.min(1, weight) : 0;
    if (w === 0) continue;
    const skin = parts(face);
    const str: Rgba = [w * v.even, 1, 0, 0];
    out.push({ phase: 0, blend: 'max', mask: RG, off: NONE4, str, verts: skin.base });
    out.push({ phase: 1, blend: 'min', mask: RG, off: NONE4, str, verts: skin.holes });
    const s = 2 * (v.warmth - 0.5) * w;
    if (s !== 0) {
      const g = parts(face, warmRingWidth(face, aspect, cap));
      const off: Rgba = [0, 0, TONE_ZERO, 0];
      const ws: Rgba = [0, 0, 0.5 * s, 0];
      out.push({ phase: 2, blend: s > 0 ? 'max' : 'min', mask: BLUE, off, str: ws, verts: g.base });
      out.push({ phase: 3, blend: s > 0 ? 'min' : 'max', mask: BLUE, off, str: ws, verts: g.holes });
    }
  }
  return out;
}
```

- [x] **Step 4: Run the tests**

Run: `npx vitest run src/engine/passes && npm run typecheck`
Expected: PASS (the existing `mask.test.ts` cases are unchanged).

- [x] **Step 5: Commit**

```bash
git add src/engine/passes/toneGeometry.ts src/engine/passes/toneGeometry.test.ts src/engine/passes/mask.ts src/engine/passes/mask.test.ts
git commit -m "v0.4 step 4 (5/20): mouth/eye fans, skin and 膚色 regions, R and Q draw lists" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The R and Q targets on the GPU (`toneMask.ts`) and the tone engine harness

**Files:**
- Create: `src/engine/passes/toneMask.ts`, `src/engine/toneRaster.node.ts`, `src/engine/toneRaster.test.ts`
- Create: `tests/e2e/pages/tone.html`, `tests/e2e/pages/tone.ts`, `tests/e2e/tone-engine.spec.ts`

**Interfaces:**
- Consumes: Task 5 (`ToneDraw`, `toneDrawsR`, `toneDrawsQ`, `R_CLEAR`, `Q_CLEAR`, `IDENTITY_WIN`, `Win`, `Rgba`, `smoothstep`, `NEUTRAL_TONE`); `createProgram`, `bindTarget`, `createFramebuffer`, `Framebuffer`, `GL` (`src/engine/gl/gl.ts:53, 160-209`).
- Produces:
  ```ts
  // src/engine/passes/toneMask.ts
  export interface ToneMaskPass { draw(dst: Framebuffer, draws: readonly ToneDraw[], win: Win, clear: Rgba): void; dispose(): void }
  export function createToneMaskPass(gl: GL): ToneMaskPass;
  // src/engine/toneRaster.node.ts (test-only)
  export function rasterizeTone(draws: readonly ToneDraw[], w: number, h: number, win: Win, clear: Rgba): Float32Array; // RGBA 0..1 in 1/255 steps
  // tests/e2e/pages/tone.ts — helpers later tasks reuse
  export const W: number, H: number, ASPECT: number, FACE: Face;
  export function b64(u8: Uint8Array): string;
  export function readFb(gl: WebGL2RenderingContext, fb: Framebuffer): Uint8Array; // rows top first
  export function glOf(): WebGL2RenderingContext;
  export function allTools(warmth: number): ToneValues;
  export function oneFace(values: ToneValues): ToneFaceInput[];
  window.runToneMasks(): { w: number; h: number; err: number; R: string; Qwarm: string; Qcool: string } // base64 RGBA8
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/engine/toneRaster.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { ToneDraw } from './passes/toneGeometry';
import { rasterizeTone } from './toneRaster.node';

const draw = (p: Partial<ToneDraw>): ToneDraw => ({
  phase: 0,
  blend: 'max',
  mask: [true, true, true, true],
  off: [0, 0, 0, 0],
  str: [1, 0, 0, 0],
  verts: Float32Array.of(0, 0, 1, 1, 0, 1, 0, 1, 1),
  ...p,
});

describe('rasterizeTone (CPU stand-in for toneMask.ts)', () => {
  it('covers the pixel centres inside the triangle with off + str · smoothstep(value), in 1/255 steps', () => {
    const out = rasterizeTone([draw({ str: [0.5, 0, 0, 0] })], 4, 4, [0, 0, 1, 1], [0, 0, 0, 0]);
    expect(out[0]).toBeCloseTo(Math.round(0.5 * 255) / 255, 9);
    expect(out[(3 * 4 + 3) * 4]).toBe(0);
  });

  it('MAX keeps the stronger value, MIN lowers, the channel mask protects the other channels, phases order the draws', () => {
    const a = draw({ str: [0.8, 0.8, 0, 0] });
    const b = draw({ phase: 1, blend: 'min', mask: [false, true, false, false], str: [0, 0.2, 0, 0] });
    const out = rasterizeTone([b, a], 4, 4, [0, 0, 1, 1], [0, 0, 0, 0]);
    expect(out[0]).toBeCloseTo(204 / 255, 9);
    expect(out[1]).toBeCloseTo(51 / 255, 9);
  });

  it('maps through the window', () => {
    const whole = rasterizeTone([draw({})], 4, 4, [0, 0, 1, 1], [0, 0, 0, 0]);
    const half = rasterizeTone([draw({})], 4, 4, [0, 0, 2, 2], [0, 0, 0, 0]);
    // the triangle (0,0)-(1,0)-(0,1) covers px centres with x + y ≤ 4 on the whole target, x + y ≤ 2 through [0, 0, 2, 2]
    expect(whole[(0 * 4 + 2) * 4]).toBeGreaterThan(0); // (2.5, 0.5)
    expect(half[(0 * 4 + 2) * 4]).toBe(0);
    expect(half[0]).toBeGreaterThan(0); // (0.5, 0.5)
  });
});
```
Create `tests/e2e/pages/tone.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>tone engine harness</title>
  </head>
  <body style="margin: 0; background: #000">
    <canvas id="gl"></canvas>
    <script type="module" src="./tone.ts"></script>
  </body>
</html>
```
Create `tests/e2e/pages/tone.ts`:
```ts
// 膚質 engine harness (skin-cleanup spec §8.2): renders the step-4 passes on the dev server with the recorded face of
// sample_face.png and hands raw RGBA8 readbacks (base64) or lossless PNGs to tests/e2e/tone-engine.spec.ts, which
// compares them with the CPU references in Node.
import landmarks from '../../fixtures/landmarks_sample_face.json';
import { createFramebuffer, type Framebuffer } from '../../../src/engine/gl/gl';
import { createToneMaskPass } from '../../../src/engine/passes/toneMask';
import { IDENTITY_WIN, NEUTRAL_TONE, Q_CLEAR, R_CLEAR, toneDrawsQ, toneDrawsR, type ToneFaceInput, type ToneValues } from '../../../src/engine/passes/toneGeometry';
import { adapt } from '../../../src/tracking/adapter111';

export const W = landmarks.width;
export const H = landmarks.height;
export const ASPECT = W / H;
export const FACE = adapt({ points: new Float32Array(landmarks.points) }, W, H);

export function b64(u8: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

/** RGBA8 rows, top first (the gl.ts convention) */
export function readFb(gl: WebGL2RenderingContext, fb: Framebuffer): Uint8Array {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb.fbo);
  const px = new Uint8Array(fb.width * fb.height * 4);
  gl.readPixels(0, 0, fb.width, fb.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return px;
}

export function glOf(): WebGL2RenderingContext {
  const gl = (document.getElementById('gl') as HTMLCanvasElement).getContext('webgl2');
  if (!gl) throw new Error('no webgl2');
  return gl;
}

export const allTools = (warmth: number): ToneValues => ({ ...NEUTRAL_TONE, even: 1, warmth, darkCircle: 1, nasolabial: 1, teeth: 1, eyeBright: 1 });
export const oneFace = (values: ToneValues): ToneFaceInput[] => [{ face: FACE, values, weight: 1, cap: null }];

declare global {
  interface Window {
    runToneMasks?: () => { w: number; h: number; err: number; R: string; Qwarm: string; Qcool: string };
  }
}

window.runToneMasks = () => {
  const gl = glOf();
  const pass = createToneMaskPass(gl);
  const w = Math.ceil(W / 4);
  const h = Math.ceil(H / 4);
  const fb = createFramebuffer(gl, w, h);
  pass.draw(fb, toneDrawsR(oneFace(allTools(1)), ASPECT), IDENTITY_WIN, R_CLEAR);
  const R = b64(readFb(gl, fb));
  pass.draw(fb, toneDrawsQ(oneFace(allTools(1)), ASPECT), IDENTITY_WIN, Q_CLEAR);
  const Qwarm = b64(readFb(gl, fb));
  pass.draw(fb, toneDrawsQ(oneFace(allTools(0)), ASPECT), IDENTITY_WIN, Q_CLEAR);
  const Qcool = b64(readFb(gl, fb));
  const err = gl.getError();
  pass.dispose();
  return { w, h, err, R, Qwarm, Qcool };
};
```
Create `tests/e2e/tone-engine.spec.ts`:
```ts
// 膚質 engine harness (skin-cleanup spec §8.2) on the dev server page tests/e2e/pages/tone.html: the GPU targets and
// passes against the CPU references (toneRaster.node.ts, toneCpu.ts, healCpu.ts).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { IDENTITY_WIN, NEUTRAL_TONE, Q_CLEAR, R_CLEAR, toneDrawsQ, toneDrawsR, type ToneFaceInput, type ToneValues } from '../../src/engine/passes/toneGeometry';
import { rasterizeTone } from '../../src/engine/toneRaster.node';
import { adapt } from '../../src/tracking/adapter111';
import { expect, test } from './fixtures';

const DEV_URL = 'http://127.0.0.1:5190';
const lm = JSON.parse(readFileSync(resolve(import.meta.dirname, '../fixtures/landmarks_sample_face.json'), 'utf8')) as {
  width: number;
  height: number;
  points: number[];
};
const ASPECT = lm.width / lm.height;
const FACE = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);
const allTools = (warmth: number): ToneValues => ({ ...NEUTRAL_TONE, even: 1, warmth, darkCircle: 1, nasolabial: 1, teeth: 1, eyeBright: 1 });
const one = (v: ToneValues): ToneFaceInput[] => [{ face: FACE, values: v, weight: 1, cap: null }];
const bytes = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));

/** mean |gpu − cpu| (0..255) and the share of channel values farther apart than 2/255 */
function compare(gpu: Uint8Array, cpu: Float32Array): { mean: number; over2: number } {
  let sum = 0;
  let over = 0;
  for (let i = 0; i < gpu.length; i++) {
    const d = Math.abs(gpu[i] - Math.round(cpu[i] * 255));
    sum += d;
    if (d > 2) over++;
  }
  return { mean: sum / gpu.length, over2: over / gpu.length };
}

async function openHarness(page: Page, fn: string): Promise<void> {
  await page.goto(`${DEV_URL}/tests/e2e/pages/tone.html`);
  await page.waitForFunction((name) => typeof (window as unknown as Record<string, unknown>)[name] === 'function', fn);
}

test('tone masks: the GPU R and Q targets equal the CPU raster of toneGeometry', async ({ page }) => {
  await openHarness(page, 'runToneMasks');
  const r = await page.evaluate(() => window.runToneMasks!());
  expect(r.err).toBe(0);
  const cases = [
    ['R', toneDrawsR(one(allTools(1)), ASPECT), R_CLEAR],
    ['Qwarm', toneDrawsQ(one(allTools(1)), ASPECT), Q_CLEAR],
    ['Qcool', toneDrawsQ(one(allTools(0)), ASPECT), Q_CLEAR],
  ] as const;
  for (const [name, draws, clear] of cases) {
    const c = compare(bytes(r[name]), rasterizeTone(draws, r.w, r.h, IDENTITY_WIN, clear));
    console.log(`${name}: mean ${c.mean.toFixed(3)}, > 2/255 ${(c.over2 * 100).toFixed(3)} %`);
    expect(c.mean, name).toBeLessThan(0.25);
    expect(c.over2, name).toBeLessThan(0.002);
  }
  const at = (s: string, x: number, y: number) => Array.from(bytes(s).subarray((y * r.w + x) * 4, (y * r.w + x) * 4 + 4));
  // left cheek (between P6 and P82, ≈ (311, 714) px): coverage 1 and 勻膚 1; warm above / cool below neutral
  const cx = Math.round(311 / 4);
  const cy = Math.round(714 / 4);
  expect(at(r.Qwarm, cx, cy).slice(0, 2)).toEqual([255, 255]);
  expect(at(r.Qwarm, cx, cy)[2]).toBeGreaterThan(128 + 50);
  expect(at(r.Qcool, cx, cy)[2]).toBeLessThan(128 - 50);
  // far from the face: R empty, Q neutral
  expect(at(r.R, 5, 5)).toEqual([0, 0, 0, 0]);
  expect(at(r.Qwarm, 5, 5)).toEqual([0, 0, 128, 0]);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/engine/toneRaster.test.ts`
Expected: FAIL — `Failed to resolve import "./toneRaster.node"`.
Run: `npm run build && npx playwright test tests/e2e/tone-engine.spec.ts`
Expected: FAIL — the page does not compile (`createToneMaskPass` missing), so `runToneMasks` never appears (timeout).

- [ ] **Step 3: Implement**

Create `src/engine/toneRaster.node.ts`:
```ts
// Test-only (Node): rasterizes toneGeometry draw lists the way toneMask.ts draws them on the GPU — pixel-centre coverage,
// the interpolated value through smoothstep, off + str · m per channel, MAX / MIN blending, 8-bit storage. Vitest has no
// GPU (the calibration test), and tone-engine.spec.ts checks the GPU targets against it.
import { smoothstep, type Rgba, type ToneDraw, type Win } from './passes/toneGeometry';

export function rasterizeTone(draws: readonly ToneDraw[], w: number, h: number, win: Win, clear: Rgba): Float32Array {
  const out = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) out.set(clear, i * 4);
  const order = draws.map((d, i) => ({ d, i })).sort((a, b) => a.d.phase - b.d.phase || a.i - b.i);
  for (const { d } of order) {
    const v = d.verts;
    for (let t = 0; t + 8 < v.length; t += 9) {
      const P = [0, 3, 6].map((k) => [((v[t + k] - win[0]) / win[2]) * w, ((v[t + k + 1] - win[1]) / win[3]) * h, v[t + k + 2]]);
      const [a, b, c] = P;
      const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (Math.abs(area) < 1e-12) continue;
      const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
      const x1 = Math.min(w - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
      const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
      const y1 = Math.min(h - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5;
          const py = y + 0.5;
          const wa = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
          const wb = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
          const wc = 1 - wa - wb;
          if (wa < 0 || wb < 0 || wc < 0) continue;
          const m = smoothstep(0, 1, wa * a[2] + wb * b[2] + wc * c[2]);
          for (let ch = 0; ch < 4; ch++) {
            if (!d.mask[ch]) continue;
            const s = d.off[ch] + d.str[ch] * m;
            const o = (y * w + x) * 4 + ch;
            out[o] = d.blend === 'max' ? Math.max(out[o], s) : Math.min(out[o], s);
          }
        }
      }
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = Math.round(Math.min(1, Math.max(0, out[i])) * 255) / 255;
  return out;
}
```
(A pixel on a shared edge drawn by two triangles is harmless: MAX and MIN are idempotent.)

Create `src/engine/passes/toneMask.ts`:
```ts
// P0 region targets R and Q of the 膚質 tools (skin-cleanup spec §4.2): toneGeometry's triangle lists drawn into a ¼-res
// RGBA8 target, each with its own blend equation (MAX / MIN) and colour mask. R is cleared to 0, Q to (0, 0, ZERO, 0).
// Original work.
import { bindTarget, createProgram, type Framebuffer, type GL, type Program } from '../gl/gl';
import type { Rgba, ToneDraw, Win } from './toneGeometry';

const TONE_MASK_VS = /* glsl */ `#version 300 es
in vec2 aPos;      // O-normalized uv
in float aVal;
uniform vec4 uWin; // O rect the target covers
out float vVal;
void main() {
  vVal = aVal;
  vec2 q = (aPos - uWin.xy) / uWin.zw;
  gl_Position = vec4(q * 2.0 - 1.0, 0.0, 1.0);
}`;

const TONE_MASK_FS = /* glsl */ `#version 300 es
precision highp float;
in float vVal;
uniform vec4 uOff;
uniform vec4 uStr;
out vec4 outColor;
void main() { outColor = uOff + uStr * smoothstep(0.0, 1.0, vVal); }`;

export interface ToneMaskPass {
  /** clear `dst` to `clear`, then every draw in ascending phase (then list order), mapped through `win` */
  draw(dst: Framebuffer, draws: readonly ToneDraw[], win: Win, clear: Rgba): void;
  dispose(): void;
}

export function createToneMaskPass(gl: GL): ToneMaskPass {
  const prog: Program = createProgram(gl, TONE_MASK_VS, TONE_MASK_FS, 'toneMask');
  const vao = gl.createVertexArray();
  const buf = gl.createBuffer();
  let bytes = 0;
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  const aPos = gl.getAttribLocation(prog.program, 'aPos');
  const aVal = gl.getAttribLocation(prog.program, 'aVal');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 12, 0);
  gl.enableVertexAttribArray(aVal);
  gl.vertexAttribPointer(aVal, 1, gl.FLOAT, false, 12, 8);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  return {
    draw(dst, draws, win, clear) {
      bindTarget(gl, dst);
      gl.colorMask(true, true, true, true);
      gl.clearColor(clear[0], clear[1], clear[2], clear[3]);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.clearColor(0, 0, 0, 0);
      if (!draws.length) return;
      const order = draws.map((d, i) => ({ d, i })).sort((a, b) => a.d.phase - b.d.phase || a.i - b.i);
      prog.use();
      gl.uniform4f(prog.u('uWin'), win[0], win[1], win[2], win[3]);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      for (const { d } of order) {
        if (!d.verts.length) continue;
        if (d.verts.byteLength > bytes) {
          bytes = d.verts.byteLength;
          gl.bufferData(gl.ARRAY_BUFFER, bytes, gl.DYNAMIC_DRAW);
        }
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, d.verts);
        gl.blendEquation(d.blend === 'max' ? gl.MAX : gl.MIN);
        gl.colorMask(d.mask[0], d.mask[1], d.mask[2], d.mask[3]);
        gl.uniform4f(prog.u('uOff'), d.off[0], d.off[1], d.off[2], d.off[3]);
        gl.uniform4f(prog.u('uStr'), d.str[0], d.str[1], d.str[2], d.str[3]);
        gl.drawArrays(gl.TRIANGLES, 0, d.verts.length / 3);
      }
      gl.colorMask(true, true, true, true);
      gl.blendEquation(gl.FUNC_ADD);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    },
    dispose() {
      prog.dispose();
      gl.deleteVertexArray(vao);
      gl.deleteBuffer(buf);
    },
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/engine/toneRaster.test.ts && npm run typecheck`
Expected: PASS.
Run: `npm run build && npx playwright test tests/e2e/tone-engine.spec.ts`
Expected: `1 passed`; the log prints the three `mean … > 2/255 …` lines.

- [ ] **Step 5: Commit**

```bash
git add src/engine/passes/toneMask.ts src/engine/toneRaster.node.ts src/engine/toneRaster.test.ts tests/e2e/pages/tone.html tests/e2e/pages/tone.ts tests/e2e/tone-engine.spec.ts
git commit -m "v0.4 step 4 (6/20): R and Q targets on the GPU, tone engine harness" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The synthetic defect fixture

**Files:**
- Create: `scripts/gen-tone-fixture.mjs`, `tests/unit/toneFixture.test.ts`
- Modify: `tests/e2e/global-setup.ts:17-29` (`globalSetup`), `.gitignore` (after line 13), `LICENSES/NOTICE.txt` (test-data list, after the `sample_face.png` entry, lines 60-61)

**Interfaces:**
- Consumes: `tests/fixtures/sample_face.png` (1000 × 1500), `tests/fixtures/landmarks_sample_face.json`, `pngjs`, `adapt` (for the pin test).
- Produces:
  ```js
  // scripts/gen-tone-fixture.mjs (ESM, plain JS)
  export function pts111Of(points, width, height) /* → Float64Array(222), as adapt() builds pts111 */;
  export function generateToneFixture(srcPng?: Buffer, landmarksJson?: object) /* → { png: Buffer, json: ToneFixture } */;
  // CLI: node scripts/gen-tone-fixture.mjs → tests/fixtures/sample_face_tone.png + sample_face_tone.json
  ```
  `ToneFixture` JSON:
  ```ts
  { source: string; width: number; height: number; fw: number /* px */;
    defects: { kind: 'blemish' | 'blotch' | 'darkCircle' | 'fold' | 'teeth' | 'sclera'; name: string;
               center: [number, number] /* px */; sigma?: number /* px */; box: [x0, y0, x1, y1] /* px, every changed pixel inside */;
               pixels: [x, y, g][] /* blemish, blotch: the core g ≥ 0.5; the others: every changed pixel */ }[];
    regions: { cheek: [x, y, w, h] /* 48 × 48 px clear of every defect */ } }
  ```
  Defect names: `dot1` `dot2` `dot3` (blemishes, S §8.3 order), `blotch1` `blotch2`, `darkL` `darkR`, `foldL` `foldR`, `teeth`, `scleraL` `scleraR`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/toneFixture.test.ts`:
```ts
// The 膚質 fixture generator (skin-cleanup spec §8.3): its copy of the adapter geometry equals adapt(), the defects sit
// where the spec puts them, nothing outside them changes, and two runs give the same bytes.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { adapt } from '../../src/tracking/adapter111';

interface Defect {
  kind: string;
  name: string;
  center: [number, number];
  sigma?: number;
  box: [number, number, number, number];
  pixels: [number, number, number][];
}
interface Fixture {
  width: number;
  height: number;
  fw: number;
  defects: Defect[];
  regions: { cheek: [number, number, number, number] };
}
interface Gen {
  pts111Of(points: number[], w: number, h: number): Float64Array;
  generateToneFixture(): { png: Buffer; json: Fixture };
}

const root = resolve(import.meta.dirname, '../..');
let gen: Gen;
let out: { png: Buffer; json: Fixture };
beforeAll(async () => {
  gen = (await import(pathToFileURL(resolve(root, 'scripts/gen-tone-fixture.mjs')).href)) as Gen;
  out = gen.generateToneFixture();
}, 60_000);

describe('gen-tone-fixture', () => {
  it('its pts111 equal adapt()', () => {
    const lm = JSON.parse(readFileSync(resolve(root, 'tests/fixtures/landmarks_sample_face.json'), 'utf8')) as { width: number; height: number; points: number[] };
    const a = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height).pts111;
    const b = gen.pts111Of(lm.points, lm.width, lm.height);
    for (let i = 0; i < 222; i++) expect(Math.abs(a[i] - b[i])).toBeLessThan(1e-6);
  });

  it('lists every defect of S §8.3, each with pixels, and the blotches ≥ 0.16 fw from every blemish', () => {
    const names = out.json.defects.map((d) => d.name);
    expect(names).toEqual(['dot1', 'dot2', 'dot3', 'blotch1', 'blotch2', 'darkL', 'darkR', 'foldL', 'foldR', 'teeth', 'scleraL', 'scleraR']);
    for (const d of out.json.defects) expect(d.pixels.length, d.name).toBeGreaterThan(30);
    expect(out.json.fw).toBeCloseTo(588.8, 0);
    const dots = out.json.defects.filter((d) => d.kind === 'blemish');
    for (const b of out.json.defects.filter((d) => d.kind === 'blotch'))
      for (const d of dots) expect(Math.hypot(b.center[0] - d.center[0], b.center[1] - d.center[1]) / out.json.fw).toBeGreaterThanOrEqual(0.16);
  });

  it('changes pixels only inside the defect boxes, and keeps the cheek patch clean', () => {
    const src = PNG.sync.read(readFileSync(resolve(root, 'tests/fixtures/sample_face.png')));
    const fix = PNG.sync.read(out.png);
    expect([fix.width, fix.height]).toEqual([src.width, src.height]);
    const inBox = (x: number, y: number) => out.json.defects.some((d) => x >= d.box[0] && x <= d.box[2] && y >= d.box[1] && y <= d.box[3]);
    let changed = 0;
    for (let y = 0; y < src.height; y++)
      for (let x = 0; x < src.width; x++) {
        const i = (y * src.width + x) * 4;
        if (src.data[i] === fix.data[i] && src.data[i + 1] === fix.data[i + 1] && src.data[i + 2] === fix.data[i + 2]) continue;
        changed++;
        expect(inBox(x, y), `${x},${y}`).toBe(true);
      }
    expect(changed).toBeGreaterThan(5000);
    const [cx, cy, cw, ch] = out.json.regions.cheek;
    for (const d of out.json.defects)
      expect(d.box[2] < cx || d.box[0] > cx + cw || d.box[3] < cy || d.box[1] > cy + ch, `cheek patch overlaps ${d.name}`).toBe(true);
  });

  it('is deterministic', () => {
    expect(gen.generateToneFixture().png.equals(out.png)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/unit/toneFixture.test.ts`
Expected: FAIL — `Cannot find module …/scripts/gen-tone-fixture.mjs`.

- [ ] **Step 3: Implement**

Create `scripts/gen-tone-fixture.mjs`:
```js
// Generates the 膚質 engine-harness fixture (skin-cleanup spec §8.3): tests/fixtures/sample_face.png with synthetic
// blemishes, blotches, dark circles, nasolabial folds, yellow teeth and red sclera, placed from its recorded landmarks
// (tests/fixtures/landmarks_sample_face.json), plus a JSON listing every defect. Deterministic; Node + pngjs only. Both
// outputs are gitignored and made by tests/e2e/global-setup.ts when missing or older than this script.
//   node scripts/gen-tone-fixture.mjs   → tests/fixtures/sample_face_tone.png + tests/fixtures/sample_face_tone.json
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = (p) => resolve(root, 'tests/fixtures', p);

// ── the part of src/tracking/adapter111.ts this script needs (tests/unit/toneFixture.test.ts pins it to adapt()) ──
const CONTOUR_LEFT = [[162, 127], 127, 234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152];
const CONTOUR_RIGHT = [152, 377, 400, 378, 379, 365, 397, 288, 361, 323, 454, 356, [356, 389]];
const DIRECT = [
  70, 63, 105, 66, 107, 336, 296, 334, 293, 300, 6, 195, 5, 1, 98, 97, 2, 326, 327, 33, 160, 157, 133, 154, 144, 362, 384, 387, 263,
  373, 381, 46, 52, 65, 55, 285, 295, 282, 276, 159, 145, [33, 133], 386, 374, [362, 263], 245, 465, 48, 278, 64, 294, 61, 39, 37, 0,
  267, 269, 291, 321, 314, 17, 84, 91, 78, 81, 13, 311, 308, 402, 14, 178, 468, 473,
];
const MIDS = [[106, 98, 102], [107, 35, 65], [108, 40, 70], [109, 5, 80], [110, 27, 81]];

/** pts111 (normalized, 222 values) of MediaPipe's 478 points, built as adapt() builds them */
export function pts111Of(points, width, height) {
  const sx = (s) => (typeof s === 'number' ? points[s * 3] : (points[s[0] * 3] + points[s[1] * 3]) * 0.5);
  const sy = (s) => (typeof s === 'number' ? points[s * 3 + 1] : (points[s[0] * 3 + 1] + points[s[1] * 3 + 1]) * 0.5);
  const out = new Float64Array(222);
  const resample = (chain, first) => {
    const X = [];
    const Y = [];
    const C = [0];
    chain.forEach((s, i) => {
      X.push(sx(s) * width);
      Y.push(sy(s) * height);
      if (i > 0) C.push(C[i - 1] + Math.hypot(X[i] - X[i - 1], Y[i] - Y[i - 1]));
    });
    const total = C[C.length - 1];
    let seg = 0;
    for (let k = 0; k < 17; k++) {
      const t = (total * k) / 16;
      while (seg < chain.length - 2 && C[seg + 1] < t) seg++;
      const len = C[seg + 1] - C[seg];
      const f = len > 0 ? Math.min(1, Math.max(0, (t - C[seg]) / len)) : 0;
      out[(first + k) * 2] = (X[seg] + (X[seg + 1] - X[seg]) * f) / width;
      out[(first + k) * 2 + 1] = (Y[seg] + (Y[seg + 1] - Y[seg]) * f) / height;
    }
  };
  resample(CONTOUR_LEFT, 0);
  resample(CONTOUR_RIGHT, 16);
  DIRECT.forEach((s, i) => {
    out[(33 + i) * 2] = sx(s);
    out[(33 + i) * 2 + 1] = sy(s);
  });
  for (const [d, a, b] of MIDS) {
    out[d * 2] = (out[a * 2] + out[b * 2]) * 0.5;
    out[d * 2 + 1] = (out[a * 2 + 1] + out[b * 2 + 1]) * 0.5;
  }
  return out;
}

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
// JPEG full-range YCbCr (skin-cleanup spec §4.4)
const toYcc = (r, g, b) => [0.299 * r + 0.587 * g + 0.114 * b, 0.5 - 0.168736 * r - 0.331264 * g + 0.5 * b, 0.5 + 0.5 * r - 0.418688 * g - 0.081312 * b];
const toRgb = (y, cb, cr) => [y + 1.402 * (cr - 0.5), y - 0.344136 * (cb - 0.5) - 0.714136 * (cr - 0.5), y + 1.772 * (cb - 0.5)];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = (a) => Math.hypot(a[0], a[1]);
const unit = (a) => mul(a, 1 / (len(a) || 1));
const mid = (a, b) => mul(add(a, b), 0.5);
function inPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function segDist(p, a, b) {
  const ab = sub(b, a);
  const t = Math.min(1, Math.max(0, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
  return len(sub(p, add(a, mul(ab, t))));
}

export function generateToneFixture(
  srcPng = readFileSync(fixture('sample_face.png')),
  lm = JSON.parse(readFileSync(fixture('landmarks_sample_face.json'), 'utf8')),
) {
  const src = PNG.sync.read(srcPng);
  const W = src.width;
  const H = src.height;
  const P111 = pts111Of(lm.points, lm.width, lm.height);
  const P = (i) => [P111[i * 2] * W, P111[i * 2 + 1] * H];
  const M = (i) => [lm.points[i * 3] * W, lm.points[i * 3 + 1] * H];
  const ext1 = M(151);
  const menton = M(152);
  const fw = len(sub(P(0), P(32)));
  const xhat = unit(sub(P(77), P(74)));
  let yhat = [-xhat[1], xhat[0]];
  if (dot(yhat, sub(menton, P(46))) < 0) yhat = mul(yhat, -1);
  const eyeW = { L: len(sub(P(52), P(55))), R: len(sub(P(58), P(61))) };
  const data = Buffer.from(src.data);
  const defects = [];

  /**
   * Applies `edit(ycc, g)` to every pixel of `box` whose weight g = weight(pixel centre, ycc) is > 0.01 and records the
   * defect; `core` keeps only pixels with g ≥ 0.5 in the list (the Gaussian defects), else every changed pixel is listed.
   */
  function apply(kind, name, center, box, weight, edit, extra = {}, core = false) {
    const x0 = Math.max(0, Math.floor(box[0]));
    const y0 = Math.max(0, Math.floor(box[1]));
    const x1 = Math.min(W - 1, Math.ceil(box[2]));
    const y1 = Math.min(H - 1, Math.ceil(box[3]));
    const pixels = [];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = (y * W + x) * 4;
        const ycc = toYcc(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
        const g = weight([x + 0.5, y + 0.5], ycc);
        if (!(g > 0.01)) continue;
        const rgb = toRgb(...edit(ycc, g));
        for (let c = 0; c < 3; c++) data[i + c] = Math.round(Math.min(1, Math.max(0, rgb[c])) * 255);
        if (!core || g >= 0.5) pixels.push([x, y, Math.round(g * 1000) / 1000]);
      }
    }
    defects.push({ kind, name, center: [Math.round(center[0] * 10) / 10, Math.round(center[1] * 10) / 10], ...extra, box: [x0, y0, x1, y1], pixels });
  }

  // 3 blemishes, Gaussian σ 5 px: Y × (1 − 0.22 g), Cr + 0.03 g
  const gauss = (c, s) => (p) => {
    const d = len(sub(p, c));
    return d <= 3 * s ? Math.exp(-(d * d) / (2 * s * s)) : 0;
  };
  for (const [name, c] of [
    ['dot1', mid(P(6), P(82))],
    ['dot2', mid(ext1, P(35))],
    ['dot3', add(mul(P(26), 0.6), mul(P(83), 0.4))],
  ]) {
    const s = 5;
    apply('blemish', name, c, [c[0] - 3 * s, c[1] - 3 * s, c[0] + 3 * s, c[1] + 3 * s], gauss(c, s), ([y, cb, cr], g) => [y * (1 - 0.22 * g), cb, cr + 0.03 * g], { sigma: s }, true);
  }
  // 2 blotches for 勻膚, Gaussian σ 0.04 fw: Cr + 0.025 g, Y × (1 − 0.03 g)
  for (const [name, c] of [
    ['blotch1', mid(P(77), P(26))],
    ['blotch2', mid(ext1, P(40))],
  ]) {
    const s = 0.04 * fw;
    apply('blotch', name, c, [c[0] - 3 * s, c[1] - 3 * s, c[0] + 3 * s, c[1] + 3 * s], gauss(c, s), ([y, cb, cr], g) => [y * (1 - 0.03 * g), cb, cr + 0.025 * g], { sigma: Math.round(s * 100) / 100 }, true);
  }
  // dark circles: an ellipse under each eye, centre = lower-mid lid + 0.22 eyeW·ŷ, semi-axes 0.45 × 0.16 eyeW (x̂ × ŷ),
  // feathered over its outer 30 %: Y × (1 − 0.16 g), Cb + 0.015 g
  for (const [name, lid, w] of [
    ['darkL', P(73), eyeW.L],
    ['darkR', P(76), eyeW.R],
  ]) {
    const c = add(lid, mul(yhat, 0.22 * w));
    const a = 0.45 * w;
    const b = 0.16 * w;
    const weight = (p) => {
      const d = sub(p, c);
      const rho = Math.hypot(dot(d, xhat) / a, dot(d, yhat) / b);
      return 1 - smooth(0.7, 1, rho);
    };
    apply('darkCircle', name, c, [c[0] - a - 2, c[1] - a - 2, c[0] + a + 2, c[1] + a + 2], weight, ([y, cb, cr], g) => [y * (1 - 0.16 * g), cb + 0.015 * g, cr]);
  }
  // nasolabial folds: a soft 6 px line from P(82|83) + 0.04 fw·o to P(84|90) + 0.06 fw·o: Y × (1 − 0.12 g)
  for (const [name, ia, ib, o] of [
    ['foldL', 82, 84, mul(xhat, -1)],
    ['foldR', 83, 90, xhat],
  ]) {
    const a = add(P(ia), mul(o, 0.04 * fw));
    const b = add(P(ib), mul(o, 0.06 * fw));
    const pad = 4;
    apply('fold', name, mid(a, b), [Math.min(a[0], b[0]) - pad, Math.min(a[1], b[1]) - pad, Math.max(a[0], b[0]) + pad, Math.max(a[1], b[1]) + pad], (p) => 1 - smooth(1, 3, segDist(p, a, b)), ([y, cb, cr], g) => [y * (1 - 0.12 * g), cb, cr]);
  }
  // yellow teeth: inner-lip polygon (96–103), pixels with Y > 0.35: Cb − 0.05
  {
    const poly = [96, 97, 98, 99, 100, 101, 102, 103].map(P);
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    const c = [xs.reduce((s, v) => s + v, 0) / xs.length, ys.reduce((s, v) => s + v, 0) / ys.length];
    apply('teeth', 'teeth', c, [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], (p, [y]) => (inPolygon(p, poly) && y > 0.35 ? 1 : 0), ([y, cb, cr]) => [y, cb - 0.05, cr]);
  }
  // red sclera: eye-ring polygons, pixels with Y > 0.5 and chroma < 0.15: Cr + 0.03
  for (const [name, ring] of [
    ['scleraL', [52, 53, 72, 54, 55, 56, 73, 57]],
    ['scleraR', [58, 59, 75, 60, 61, 62, 76, 63]],
  ]) {
    const poly = ring.map(P);
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    const c = [xs.reduce((s, v) => s + v, 0) / xs.length, ys.reduce((s, v) => s + v, 0) / ys.length];
    apply('sclera', name, c, [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], (p, [y, cb, cr]) => (inPolygon(p, poly) && y > 0.5 && 2 * Math.hypot(cb - 0.5, cr - 0.5) < 0.15 ? 1 : 0), ([y, cb, cr]) => [y, cb, cr + 0.03]);
  }

  const cheek = mid(P(26), P(90));
  const png = new PNG({ width: W, height: H });
  data.copy(png.data);
  return {
    png: PNG.sync.write(png),
    json: {
      source: 'tests/fixtures/sample_face.png',
      generator: 'scripts/gen-tone-fixture.mjs',
      width: W,
      height: H,
      fw: Math.round(fw * 100) / 100,
      defects,
      regions: { cheek: [Math.round(cheek[0] - 24), Math.round(cheek[1] - 24), 48, 48] },
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { png, json } = generateToneFixture();
  writeFileSync(fixture('sample_face_tone.png'), png);
  writeFileSync(fixture('sample_face_tone.json'), JSON.stringify(json));
  console.log(`sample_face_tone.png: ${json.defects.length} defects, ${json.defects.reduce((s, d) => s + d.pixels.length, 0)} listed pixels`);
}
```
`tests/e2e/global-setup.ts` — it already imports `existsSync, statSync` (line 5) and rebuilds a generated file through its `stale(out, ...inputs)` helper (lines 10-15). Add the generation after the `group.y4m` block (after line 25, before the `dist/` check):
```ts
  const toneInputs = ['scripts/gen-tone-fixture.mjs', 'tests/fixtures/sample_face.png', 'tests/fixtures/landmarks_sample_face.json'];
  if (stale(resolve(root, 'tests/fixtures/sample_face_tone.png'), ...toneInputs) || stale(resolve(root, 'tests/fixtures/sample_face_tone.json'), ...toneInputs)) {
    execFileSync(process.execPath, [resolve(root, 'scripts/gen-tone-fixture.mjs')], { cwd: root, stdio: 'inherit' });
  }
```
and extend its header comment: "…, and tests/fixtures/sample_face_tone.{png,json} (gitignored, generated from sample_face.png by scripts/gen-tone-fixture.mjs) …".

`.gitignore` — after `tests/fixtures/*.y4m` (line 13):
```
# the 膚質 engine-harness fixture (scripts/gen-tone-fixture.mjs, made by tests/e2e/global-setup.ts)
tests/fixtures/sample_face_tone.png
tests/fixtures/sample_face_tone.json
```
`LICENSES/NOTICE.txt` — in the test-data list, after the `sample_face.png` entry and its `sample_face.pose.json` continuation line (lines 60-61 at `0203207`):
```
  - tests/fixtures/sample_face_tone.png (generated, not committed): modified derivative of sample_face.png
    (Apache-2.0 §4(b) change notice): synthetic blemishes, blotches, dark circles, nasolabial folds, yellow teeth and
    red sclera drawn by scripts/gen-tone-fixture.mjs; sample_face_tone.json lists them.
```

- [ ] **Step 4: Run the test and the generator**

Run: `npx vitest run tests/unit/toneFixture.test.ts`
Expected: PASS (4 tests).
Run: `node scripts/gen-tone-fixture.mjs && git status --short tests/fixtures`
Expected: prints `sample_face_tone.png: 12 defects, … listed pixels`; `git status` shows nothing for `tests/fixtures` (both outputs ignored).

- [ ] **Step 5: Commit**

```bash
git add scripts/gen-tone-fixture.mjs tests/unit/toneFixture.test.ts tests/e2e/global-setup.ts .gitignore LICENSES/NOTICE.txt
git commit -m "v0.4 step 4 (7/20): synthetic 膚質 defect fixture, generated in e2e setup" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The `TONE` table and the CPU reference of the tone field and retouch (`toneCpu.ts`)

**Files:**
- Create: `src/engine/shaders/tone.ts` (constants and kernel math only; Task 11 adds the GLSL)
- Create: `src/engine/toneCpu.ts`
- Test: `src/engine/toneCpu.test.ts`

**Interfaces:**
- Consumes: Task 5 (`TONE_ZERO`, `IDENTITY_WIN`, `Win`, `smoothstep`).
- Produces:
  ```ts
  // src/engine/shaders/tone.ts
  export const TONE: { conf; evenGuard; darkGuard; even: {chroma; lift}; darkCircle: {lift; chroma}; nasolabial: {lift; chroma};
                       warm; cool; skinCb; skinCr; skinSoft; deltaMax; teeth: {...}; eye: {...} };
  export function sigmaMid(se: number): number;                     // 0.0141 · SE
  export function sigmaLow(fwMaxPx: number, se: number): number;    // clamp(0.08 fw_max, 3 σ_mid, 0.12 SE)
  export function lFactor(sigmaLowPx: number): 16 | 32;
  export const MAX_BLUR_RADIUS: number;                             // 31
  export function gaussWeights(sigma: number): Float32Array;        // one-sided, w0 + 2Σwk = 1
  export function fieldSizes(w: number, h: number, sigmaLowPx: number): { d8: { w: number; h: number }; fL: 16 | 32; l: { w: number; h: number } };
  export function glf(v: number): string;                           // GLSL float literal
  // src/engine/toneCpu.ts
  export interface Img { w: number; h: number; d: Float32Array }   // RGBA 0..1, row 0 = top
  export const LUMA709: readonly [number, number, number];
  export function q8(v: number): number;
  export function makeImg(w: number, h: number, fill?: readonly number[]): Img;
  export function fromRgba8(w: number, h: number, data: ArrayLike<number>): Img;
  export function toRgba8(a: Img): Uint8ClampedArray;
  export function texel(a: Img, x: number, y: number, out: number[]): number[];
  export function sample(a: Img, u: number, v: number, out: number[]): number[];   // LINEAR + CLAMP_TO_EDGE
  export function toYcc(r: number, g: number, b: number): [number, number, number];
  export function fromYcc(y: number, cb: number, cr: number): [number, number, number];
  export function skinGate(r: number, g: number, b: number): number;
  export function down8(base: Img): Img;
  export function blurAxis(a: Img, w: Float32Array, axis: 'h' | 'v'): Img;
  export function lBox(mn8: Img, q: Img, fL: 16 | 32): Img;
  export function bandOf(m: ArrayLike<number>, L: ArrayLike<number>): { conf: number; bY: number; bC: [number, number, number] };
  export function deltaTexel(m: ArrayLike<number>, L: ArrayLike<number>, q: ArrayLike<number>, r: ArrayLike<number>, out: number[]): number[];
  export function deltaField(mn8: Img, l: Img, q: Img, r: Img): Img;   // encoded TONE_ZERO + 2Δ
  export interface ToneFieldCpu { mn8: Img; l: Img | null; delta8: Img | null }
  export function toneFieldCpu(base0: Img, q: Img, r: Img, sigmaLowPx: number, fieldOn: boolean): ToneFieldCpu;
  export function retouchPixel(c: number[], b0: ArrayLike<number>, mn: ArrayLike<number>, rB: number, rA: number): number[];
  export function retouchCpu(base0: Img, field: ToneFieldCpu | null, r: Img, fieldOn: boolean, win?: Win): Img;
  ```
  Kernel note: the Gaussian passes take direct texel taps with these weights (one `texelFetch` per tap, radius ≤ 31) instead of S §4.3's linear-sampled tap pairs; the buffers are ⅛ size or smaller, so the cost is the same order, and the CPU port then matches the GPU tap for tap.

- [ ] **Step 1: Write the failing tests**

Create `src/engine/toneCpu.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { TONE_ZERO } from './passes/toneGeometry';
import { gaussWeights, lFactor, sigmaLow, sigmaMid } from './shaders/tone';
import { bandOf, fromYcc, LUMA709, makeImg, q8, retouchCpu, retouchPixel, sample, toneFieldCpu, toYcc, type Img } from './toneCpu';

const SKIN = [0.8, 0.62, 0.52] as const;
const lum = (c: ArrayLike<number>) => LUMA709[0] * c[0] + LUMA709[1] * c[1] + LUMA709[2] * c[2];
function image(w: number, h: number, f: (x: number, y: number) => readonly number[]): Img {
  const o = makeImg(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = f(x, y);
      o.d.set([q8(c[0]), q8(c[1]), q8(c[2]), 1], (y * w + x) * 4);
    }
  return o;
}
/** a ¼-res target filled with one value */
const quarter = (w: number, h: number, rgba: readonly number[]) => makeImg(Math.ceil(w / 4), Math.ceil(h / 4), rgba);
const Q = (w: number, h: number, even = 0, b = TONE_ZERO) => quarter(w, h, [even, 1, b, 0]);
const R = (w: number, h: number, rgba: readonly number[] = [0, 0, 0, 0]) => quarter(w, h, rgba);
const px = (a: Img, x: number, y: number) => Array.from(a.d.subarray((y * a.w + x) * 4, (y * a.w + x) * 4 + 3));

describe('toneCpu (skin-cleanup spec §4.3–4.4)', () => {
  it('neutral values give Δ = 0, and the retouch output equals the input bit for bit', () => {
    const base = image(160, 120, (x, y) => [0.7 + 0.1 * Math.sin(x / 7), 0.55, 0.45 + 0.05 * Math.cos(y / 5)]);
    const f = toneFieldCpu(base, Q(160, 120), R(160, 120), 30, true);
    for (let i = 0; i < f.delta8!.d.length; i += 4) for (let c = 0; c < 3; c++) expect(f.delta8!.d[i + c]).toBeCloseTo(TONE_ZERO, 6);
    expect(Array.from(retouchCpu(base, f, R(160, 120), true).d)).toEqual(Array.from(base.d));
  });

  it('勻膚 at 1 cancels ≥ 85 % of the mid-band chroma bC, while I − Mn changes ≤ 1/255 on average', () => {
    const w = 512;
    const h = 256;
    // a zero-luma chroma wave between σ_mid (7.2 px) and σ_low (61 px): R up, G down by the luma-neutral ratio
    const wave = (x: number) => 0.03 * Math.cos((2 * Math.PI * x) / 96);
    const base = image(w, h, (x) => [SKIN[0] + wave(x), SKIN[1] - (wave(x) * LUMA709[0]) / LUMA709[1], SKIN[2]]);
    const sl = sigmaLow(10_000, Math.min(w, h)); // the 0.12 SE cap
    const f = toneFieldCpu(base, Q(w, h, 1), R(w, h), sl, true);
    let dot = 0;
    let norm = 0;
    const m = [0, 0, 0, 0];
    const L = [0, 0, 0, 0];
    for (let y = 4; y < f.mn8.h - 4; y++)
      for (let x = 4; x < f.mn8.w - 4; x++) {
        const u = (x + 0.5) / f.mn8.w;
        const v = (y + 0.5) / f.mn8.h;
        sample(f.mn8, u, v, m);
        sample(f.l!, u, v, L);
        const { bC } = bandOf(m, L);
        for (let c = 0; c < 3; c++) {
          const d = (f.delta8!.d[(y * f.mn8.w + x) * 4 + c] - TONE_ZERO) / 2;
          dot += -d * bC[c];
          norm += bC[c] * bC[c];
        }
      }
    expect(dot / norm).toBeGreaterThanOrEqual(0.85);
    const out = retouchCpu(base, f, R(w, h), true);
    const fOut = toneFieldCpu(out, Q(w, h, 1), R(w, h), sl, false);
    let hf = 0;
    let n = 0;
    const a = [0, 0, 0, 0];
    const b = [0, 0, 0, 0];
    for (let y = 32; y < h - 32; y += 3)
      for (let x = 32; x < w - 32; x += 3) {
        sample(f.mn8, (x + 0.5) / w, (y + 0.5) / h, a);
        sample(fOut.mn8, (x + 0.5) / w, (y + 0.5) / h, b);
        for (let c = 0; c < 3; c++) hf += Math.abs(out.d[(y * w + x) * 4 + c] - b[c] - (base.d[(y * w + x) * 4 + c] - a[c]));
        n += 3;
      }
    expect((hf / n) * 255).toBeLessThanOrEqual(1);
  });

  it('a mole (mid-band luma −0.2) is left alone by 勻膚', () => {
    const w = 256;
    const sMid = sigmaMid(w);
    const blob = (x: number, y: number) => 0.25 * Math.exp(-((x - 128) ** 2 + (y - 128) ** 2) / (2 * (3 * sMid) ** 2));
    const base = image(w, w, (x, y) => [SKIN[0] - blob(x, y), SKIN[1] - blob(x, y), SKIN[2] - blob(x, y)]);
    const f = toneFieldCpu(base, Q(w, w, 1), R(w, w), sigmaLow(10_000, w), true);
    const out = retouchCpu(base, f, R(w, w), true);
    for (const [x, y] of [[128, 128], [126, 130], [131, 127]]) for (let c = 0; c < 3; c++) expect(Math.abs(px(out, x, y)[c] - px(base, x, y)[c]) * 255).toBeLessThanOrEqual(1);
  });

  it('黑眼圈 lifts only darker-than-reference shading', () => {
    const w = 256;
    const s = 2.5 * sigmaMid(w);
    const g = (x: number, y: number, cx: number) => Math.exp(-((x - cx) ** 2 + (y - 128) ** 2) / (2 * s * s));
    const base = image(w, w, (x, y) => SKIN.map((v) => v - 0.06 * g(x, y, 70) + 0.06 * g(x, y, 186)));
    const f = toneFieldCpu(base, Q(w, w), R(w, w, [1, 0, 0, 0]), sigmaLow(10_000, w), true);
    const out = retouchCpu(base, f, R(w, w, [1, 0, 0, 0]), true);
    expect(lum(px(out, 70, 128)) - lum(px(base, 70, 128))).toBeGreaterThan(0.02);
    expect(Math.abs(lum(px(out, 186, 128)) - lum(px(base, 186, 128))) * 255).toBeLessThanOrEqual(1);
  });

  it('膚色 ±1 moves skin Cb in opposite directions by similar amounts, keeps the luma, and leaves green and blue alone', () => {
    const w = 64;
    const base = image(w, w, (x) => (x < 22 ? SKIN : x < 44 ? [0.2, 0.6, 0.3] : [0.2, 0.3, 0.7]));
    const run = (b: number) => retouchCpu(base, toneFieldCpu(base, Q(w, w, 0, b), R(w, w), sigmaLow(10_000, w), true), R(w, w), true);
    const warm = run(1);
    const cool = run(0);
    const cb = (a: Img) => toYcc(...(px(a, 11, 32) as [number, number, number]))[1];
    const dWarm = cb(warm) - cb(base);
    const dCool = cb(cool) - cb(base);
    expect(dWarm).toBeLessThan(-0.008);
    expect(dCool).toBeGreaterThan(0.008);
    expect(Math.abs(dWarm) / Math.abs(dCool)).toBeGreaterThan(0.7);
    expect(Math.abs(dWarm) / Math.abs(dCool)).toBeLessThan(1.43);
    for (const a of [warm, cool]) {
      expect(Math.abs(lum(px(a, 11, 32)) - lum(px(base, 11, 32))) * 255).toBeLessThanOrEqual(1);
      expect(px(a, 33, 32)).toEqual(px(base, 33, 32));
      expect(px(a, 55, 32)).toEqual(px(base, 55, 32));
    }
  });

  it('白牙 neutralizes yellow-white and leaves lips and gums alone', () => {
    const tooth = [0.85, 0.8, 0.62];
    const out = retouchPixel([...tooth], tooth, tooth, 1, 0);
    expect(Math.abs(toYcc(...(out as [number, number, number]))[1] - 0.5)).toBeLessThanOrEqual(0.5 * Math.abs(toYcc(0.85, 0.8, 0.62)[1] - 0.5));
    for (const lip of [[0.75, 0.4, 0.42], [0.8, 0.45, 0.48]]) {
      const o = retouchPixel([...lip], lip, lip, 1, 0);
      for (let c = 0; c < 3; c++) expect(Math.abs(o[c] - lip[c]) * 255).toBeLessThan(0.5);
    }
  });

  it('亮眼 detints the sclera, and its clarity term respects the ±0.12 clamp', () => {
    const sclera = [0.86, 0.78, 0.77];
    const o = retouchPixel([...sclera], sclera, sclera, 0, 1);
    const before = Math.abs(toYcc(0.86, 0.78, 0.77)[2] - 0.5);
    expect(Math.abs(toYcc(...(o as [number, number, number]))[2] - 0.5)).toBeLessThanOrEqual(0.5 * before);
    const iris = [0.3, 0.45, 0.35];
    const flat = retouchPixel([...iris], iris, iris, 0, 1);
    const sharp = retouchPixel([...iris], iris, iris.map((v) => v - 0.3), 0, 1);
    for (let c = 0; c < 3; c++) {
      expect(sharp[c] - flat[c]).toBeGreaterThan(0);
      expect(sharp[c] - flat[c]).toBeLessThanOrEqual(0.7 * 0.12 + 1e-9);
    }
  });

  it('σ_low and the L reduction', () => {
    expect(sigmaLow(589, 1000)).toBeCloseTo(47.12, 2);
    expect(sigmaLow(100, 1000)).toBeCloseTo(42.3, 6);
    expect(sigmaLow(5000, 1000)).toBe(120);
    expect(lFactor(96)).toBe(16);
    expect(lFactor(96.01)).toBe(32);
    for (const s of [0.5, 1.76, 2.9, 7.7]) {
      const w = gaussWeights(s);
      expect(w[0] + 2 * w.slice(1).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
      expect(w.length - 1).toBe(Math.min(31, Math.ceil(3 * s)));
    }
  });

  it('the Δ offset encoding round-trips within 0.5/255', () => {
    for (let d = -0.24; d <= 0.24; d += 0.0007) expect(Math.abs((q8(TONE_ZERO + 2 * d) - TONE_ZERO) / 2 - d)).toBeLessThanOrEqual(0.5 / 255);
  });

  it('YCbCr is JPEG full range and round-trips', () => {
    const [y, cb, cr] = toYcc(0.8, 0.62, 0.52);
    const back = fromYcc(y, cb, cr);
    expect(back[0]).toBeCloseTo(0.8, 5);
    expect(back[1]).toBeCloseTo(0.62, 5);
    expect(back[2]).toBeCloseTo(0.52, 5);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/engine/toneCpu.test.ts`
Expected: FAIL — `Failed to resolve import "./shaders/tone"`.

- [ ] **Step 3: Implement**

Create `src/engine/shaders/tone.ts`:
```ts
// 膚質 shaders and their shared constants (skin-cleanup spec §4.3–4.4). The TONE table is baked into the GLSL text, so the
// hash pin in toneCpu.test.ts covers it; src/engine/toneCpu.ts mirrors every stage. Original work.

/** Every tunable constant of the tone field and the retouch. Task 9 calibrates the gains on the fixture. */
export const TONE = {
  /** conf = smoothstep(conf0, conf1, L.a): how much skin the low-pass reference saw */
  conf: [0.15, 0.3],
  /** 勻膚 leaves mid-band luma steps beyond these alone (moles, brows, nostrils) */
  evenGuard: [0.06, 0.14],
  /** 黑眼圈 / 法令紋 leave darkness beyond these alone (lashes, frames) */
  darkGuard: [0.2, 0.3],
  even: { chroma: 0.9, lift: 0.45 },
  darkCircle: { lift: 0.85, chroma: 0.7 },
  nasolabial: { lift: 0.8, chroma: 0.3 },
  /** 膚色 RGB gains per unit of s: warm (s > 0) and cool (s < 0) */
  warm: [0.06, 0.02, -0.07],
  cool: [-0.03, -0.02, 0.07],
  /** skin(c): soft box on Cb and Cr (Chai & Ngan 1999, 8-bit 77–127 and 133–173) */
  skinCb: [0.302, 0.498],
  skinCr: [0.522, 0.678],
  skinSoft: 0.03,
  /** Δ is clamped to ±deltaMax before the 8-bit encoding TONE_ZERO + 2Δ */
  deltaMax: 0.25,
  teeth: { y: [0.28, 0.42], cr: [0.555, 0.6], cb: 0.75, crPull: 0.35, lift: 0.08 },
  eye: {
    scY: [0.32, 0.5],
    scCh: [0.1, 0.2],
    detint: 0.6,
    scLift: 0.05,
    irCh: [0.05, 0.12],
    irY0: [0.06, 0.12],
    irY1: [0.45, 0.6],
    irLift: 0.04,
    clarity: 0.7,
    clamp: 0.12,
  },
} as const;

/** σ_mid = 0.0141·SE: the effective σ of the P3/P4 sparse mean (uniforms.ts:42-61), so 勻膚's mid band is 磨皮's */
export const sigmaMid = (se: number): number => 0.0141 * se;

/** σ_low = clamp(0.08·fw_max, 3σ_mid, 0.12·SE), in working px (fw_max: the largest edited face, S §4.3) */
export function sigmaLow(fwMaxPx: number, se: number): number {
  return Math.min(0.12 * se, Math.max(3 * sigmaMid(se), 0.08 * fwMaxPx));
}

/** L is built at 1/16 of the working size when σ_low ≤ 96 working px, else at 1/32 */
export const lFactor = (sigmaLowPx: number): 16 | 32 => (sigmaLowPx <= 96 ? 16 : 32);

export const MAX_BLUR_RADIUS = 31;

/** one-sided Gaussian weights w[0..R], R = min(31, ⌈3σ⌉), normalized so w0 + 2·Σ w_k = 1; σ ≤ 0 → [1] */
export function gaussWeights(sigma: number): Float32Array {
  if (!(sigma > 0)) return Float32Array.of(1);
  const R = Math.min(MAX_BLUR_RADIUS, Math.ceil(3 * sigma));
  const w = new Float64Array(R + 1);
  let s = 0;
  for (let k = 0; k <= R; k++) {
    w[k] = Math.exp(-(k * k) / (2 * sigma * sigma));
    s += k === 0 ? w[k] : 2 * w[k];
  }
  return Float32Array.from(w, (v) => v / s);
}

export interface FieldSizes {
  d8: { w: number; h: number };
  fL: 16 | 32;
  l: { w: number; h: number };
}
export function fieldSizes(w: number, h: number, sigmaLowPx: number): FieldSizes {
  const d8 = { w: Math.ceil(w / 8), h: Math.ceil(h / 8) };
  const fL = lFactor(sigmaLowPx);
  const k = fL / 8;
  return { d8, fL, l: { w: Math.ceil(d8.w / k), h: Math.ceil(d8.h / k) } };
}

/** a GLSL float literal of `v` (the table goes into the shader text) */
export function glf(v: number): string {
  return Number.isInteger(v) ? v.toFixed(1) : String(v);
}
```
Create `src/engine/toneCpu.ts`:
```ts
// CPU reference of the 膚質 tone field P0c and retouch P0d (skin-cleanup spec §4.3–4.4): the stages of the shaders in
// ./shaders/tone.ts, with the 8-bit rounding every RGBA8 target applies after each stage. Pure, no GL. toneCpu.test.ts pins
// the shader text by hash; tests/e2e/tone-engine.spec.ts compares the GPU with this port.
// Y in the field is Rec. 709 luma; the retouch (白牙, 亮眼) works in JPEG full-range YCbCr (S §4.4).
import { IDENTITY_WIN, smoothstep, TONE_ZERO, type Win } from './passes/toneGeometry';
import { gaussWeights, lFactor, sigmaMid, TONE } from './shaders/tone';

/** RGBA, 0..1, row 0 = image top */
export interface Img {
  w: number;
  h: number;
  d: Float32Array;
}

export const LUMA709: readonly [number, number, number] = [0.2126, 0.7152, 0.0722];

export const q8 = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 255) / 255;

export function makeImg(w: number, h: number, fill?: readonly number[]): Img {
  const d = new Float32Array(w * h * 4);
  if (fill) for (let i = 0; i < w * h; i++) d.set(fill, i * 4);
  return { w, h, d };
}

export function fromRgba8(w: number, h: number, data: ArrayLike<number>): Img {
  const o = makeImg(w, h);
  for (let i = 0; i < w * h * 4; i++) o.d[i] = data[i] / 255;
  return o;
}

export function toRgba8(a: Img): Uint8ClampedArray {
  const o = new Uint8ClampedArray(a.w * a.h * 4);
  for (let i = 0; i < o.length; i++) o[i] = Math.round(Math.min(1, Math.max(0, a.d[i])) * 255);
  return o;
}

function quantize(a: Img): Img {
  for (let i = 0; i < a.d.length; i++) a.d[i] = q8(a.d[i]);
  return a;
}

/** texelFetch with the coordinate clamped into the image */
export function texel(a: Img, x: number, y: number, out: number[]): number[] {
  const i = (Math.min(a.h - 1, Math.max(0, y)) * a.w + Math.min(a.w - 1, Math.max(0, x))) * 4;
  out[0] = a.d[i];
  out[1] = a.d[i + 1];
  out[2] = a.d[i + 2];
  out[3] = a.d[i + 3];
  return out;
}

/** texture() with LINEAR filtering and CLAMP_TO_EDGE at (u, v) */
export function sample(a: Img, u: number, v: number, out: number[]): number[] {
  const x = u * a.w - 0.5;
  const y = v * a.h - 0.5;
  const fx0 = Math.floor(x);
  const fy0 = Math.floor(y);
  const fx = x - fx0;
  const fy = y - fy0;
  const x0 = Math.min(a.w - 1, Math.max(0, fx0));
  const x1 = Math.min(a.w - 1, Math.max(0, fx0 + 1));
  const y0 = Math.min(a.h - 1, Math.max(0, fy0));
  const y1 = Math.min(a.h - 1, Math.max(0, fy0 + 1));
  const i00 = (y0 * a.w + x0) * 4;
  const i10 = (y0 * a.w + x1) * 4;
  const i01 = (y1 * a.w + x0) * 4;
  const i11 = (y1 * a.w + x1) * 4;
  for (let c = 0; c < 4; c++) {
    out[c] = (a.d[i00 + c] * (1 - fx) + a.d[i10 + c] * fx) * (1 - fy) + (a.d[i01 + c] * (1 - fx) + a.d[i11 + c] * fx) * fy;
  }
  return out;
}

export function toYcc(r: number, g: number, b: number): [number, number, number] {
  return [0.299 * r + 0.587 * g + 0.114 * b, 0.5 - 0.168736 * r - 0.331264 * g + 0.5 * b, 0.5 + 0.5 * r - 0.418688 * g - 0.081312 * b];
}
export function fromYcc(y: number, cb: number, cr: number): [number, number, number] {
  return [y + 1.402 * (cr - 0.5), y - 0.344136 * (cb - 0.5) - 0.714136 * (cr - 0.5), y + 1.772 * (cb - 0.5)];
}

const box = (x: number, lo: number, hi: number, e: number) => smoothstep(lo - e, lo, x) * (1 - smoothstep(hi, hi + e, x));
/** skin(c): soft box on Cb and Cr; keeps 膚色 off hair, clothes and background inside the wide ring */
export function skinGate(r: number, g: number, b: number): number {
  const [, cb, cr] = toYcc(r, g, b);
  return box(cb, TONE.skinCb[0], TONE.skinCb[1], TONE.skinSoft) * box(cr, TONE.skinCr[0], TONE.skinCr[1], TONE.skinSoft);
}

/** D8: the 8 × 8 box mean (the GPU takes 16 bilinear taps, each the mean of a 2 × 2 block) */
export function down8(base: Img): Img {
  const o = makeImg(Math.ceil(base.w / 8), Math.ceil(base.h / 8));
  const t = [0, 0, 0, 0];
  for (let j = 0; j < o.h; j++)
    for (let i = 0; i < o.w; i++) {
      const s = [0, 0, 0, 0];
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) {
          texel(base, i * 8 + x, j * 8 + y, t);
          for (let c = 0; c < 4; c++) s[c] += t[c];
        }
      for (let c = 0; c < 4; c++) o.d[(j * o.w + i) * 4 + c] = s[c] / 64;
    }
  return quantize(o);
}

/** one pass of the separable Gaussian, direct texel taps, edges clamped */
export function blurAxis(a: Img, w: Float32Array, axis: 'h' | 'v'): Img {
  const o = makeImg(a.w, a.h);
  const t = [0, 0, 0, 0];
  const u = [0, 0, 0, 0];
  for (let y = 0; y < a.h; y++)
    for (let x = 0; x < a.w; x++) {
      texel(a, x, y, t);
      const s = [w[0] * t[0], w[0] * t[1], w[0] * t[2], w[0] * t[3]];
      for (let k = 1; k < w.length; k++) {
        if (axis === 'h') {
          texel(a, x + k, y, t);
          texel(a, x - k, y, u);
        } else {
          texel(a, x, y + k, t);
          texel(a, x, y - k, u);
        }
        for (let c = 0; c < 4; c++) s[c] += w[k] * (t[c] + u[c]);
      }
      o.d.set(s, (y * a.w + x) * 4);
    }
  return quantize(o);
}

/** L's first stage: the (fL/8)² box of (Mn8 · q, q), q = Q.G sampled at each Mn8 texel centre (a normalized convolution) */
export function lBox(mn8: Img, q: Img, fL: 16 | 32): Img {
  const k = fL / 8;
  const o = makeImg(Math.ceil(mn8.w / k), Math.ceil(mn8.h / k));
  const t = [0, 0, 0, 0];
  const qv = [0, 0, 0, 0];
  for (let j = 0; j < o.h; j++)
    for (let i = 0; i < o.w; i++) {
      const s = [0, 0, 0, 0];
      for (let jj = 0; jj < k; jj++)
        for (let ii = 0; ii < k; ii++) {
          const tx = Math.min(mn8.w - 1, i * k + ii);
          const ty = Math.min(mn8.h - 1, j * k + jj);
          texel(mn8, tx, ty, t);
          sample(q, (tx + 0.5) / mn8.w, (ty + 0.5) / mn8.h, qv);
          const g = qv[1];
          s[0] += t[0] * g;
          s[1] += t[1] * g;
          s[2] += t[2] * g;
          s[3] += g;
        }
      for (let c = 0; c < 4; c++) o.d[(j * o.w + i) * 4 + c] = s[c] / (k * k);
    }
  return quantize(o);
}

/** the mid band b = Mn8 − L_c, split into luma bY and chroma bC, and the reference's confidence */
export function bandOf(m: ArrayLike<number>, L: ArrayLike<number>): { conf: number; bY: number; bC: [number, number, number] } {
  const a = Math.max(L[3], 1 / 255);
  const b0 = m[0] - L[0] / a;
  const b1 = m[1] - L[1] / a;
  const b2 = m[2] - L[2] / a;
  const bY = LUMA709[0] * b0 + LUMA709[1] * b1 + LUMA709[2] * b2;
  return { conf: smoothstep(TONE.conf[0], TONE.conf[1], L[3]), bY, bC: [b0 - bY, b1 - bY, b2 - bY] };
}

/** Δ of one ⅛ texel, unencoded (S §4.3) */
export function deltaTexel(m: ArrayLike<number>, L: ArrayLike<number>, q: ArrayLike<number>, r: ArrayLike<number>, out: number[]): number[] {
  const { conf, bY, bC } = bandOf(m, L);
  const lift = -Math.min(bY, 0);
  const gE = 1 - smoothstep(TONE.evenGuard[0], TONE.evenGuard[1], Math.abs(bY));
  const gD = 1 - smoothstep(TONE.darkGuard[0], TONE.darkGuard[1], -bY);
  const kE = q[0] * conf * gE;
  const kD = r[0] * conf * gD;
  const kN = r[1] * conf * gD;
  for (let c = 0; c < 3; c++) {
    out[c] =
      kE * (-TONE.even.chroma * bC[c] + TONE.even.lift * lift) +
      kD * (TONE.darkCircle.lift * lift - TONE.darkCircle.chroma * bC[c]) +
      kN * (TONE.nasolabial.lift * lift - TONE.nasolabial.chroma * bC[c]);
  }
  const s = Math.min(1, Math.max(-1, 2 * (q[2] - TONE_ZERO)));
  if (Math.abs(s) > 0.5 / 255) {
    const c0 = [m[0] + out[0], m[1] + out[1], m[2] + out[2]];
    const k = s >= 0 ? TONE.warm : TONE.cool;
    const a = Math.abs(s);
    const c1 = [c0[0] * (1 + a * k[0]), c0[1] * (1 + a * k[1]), c0[2] * (1 + a * k[2])];
    const y0 = LUMA709[0] * c0[0] + LUMA709[1] * c0[1] + LUMA709[2] * c0[2];
    const y1 = LUMA709[0] * c1[0] + LUMA709[1] * c1[1] + LUMA709[2] * c1[2];
    const keep = y0 / Math.max(y1, 1e-4);
    const sg = skinGate(c0[0], c0[1], c0[2]);
    for (let c = 0; c < 3; c++) out[c] += (c1[c] * keep - c0[c]) * sg;
  }
  return out;
}

/** Δ8: TONE_ZERO + 2·clamp(Δ, ±deltaMax) per ⅛ texel, from Mn8 (texel), L, Q and R (bilinear at the texel centre) */
export function deltaField(mn8: Img, l: Img, q: Img, r: Img): Img {
  const o = makeImg(mn8.w, mn8.h);
  const m = [0, 0, 0, 0];
  const L = [0, 0, 0, 0];
  const qv = [0, 0, 0, 0];
  const rv = [0, 0, 0, 0];
  const d = [0, 0, 0];
  for (let j = 0; j < mn8.h; j++)
    for (let i = 0; i < mn8.w; i++) {
      const u = (i + 0.5) / mn8.w;
      const v = (j + 0.5) / mn8.h;
      texel(mn8, i, j, m);
      sample(l, u, v, L);
      sample(q, u, v, qv);
      sample(r, u, v, rv);
      deltaTexel(m, L, qv, rv, d);
      const k = (j * mn8.w + i) * 4;
      for (let c = 0; c < 3; c++) o.d[k + c] = TONE_ZERO + 2 * Math.min(TONE.deltaMax, Math.max(-TONE.deltaMax, d[c]));
      o.d[k + 3] = 1;
    }
  return quantize(o);
}

export interface ToneFieldCpu {
  mn8: Img;
  l: Img | null;
  delta8: Img | null;
}

/** P0c from `base0` at working resolution; `fieldOn` false (亮眼 only) stops after Mn8 */
export function toneFieldCpu(base0: Img, q: Img, r: Img, sigmaLowPx: number, fieldOn: boolean): ToneFieldCpu {
  const wm = gaussWeights(sigmaMid(Math.min(base0.w, base0.h)) / 8);
  const mn8 = blurAxis(blurAxis(down8(base0), wm, 'h'), wm, 'v');
  if (!fieldOn) return { mn8, l: null, delta8: null };
  const fL = lFactor(sigmaLowPx);
  const wl = gaussWeights(sigmaLowPx / fL);
  const l = blurAxis(blurAxis(lBox(mn8, q, fL), wl, 'h'), wl, 'v');
  return { mn8, l, delta8: deltaField(mn8, l, q, r) };
}

/** 白牙 then 亮眼 on one pixel (S §4.4): `c` = base0 + Δ (in/out), `b0` = base0, `mn` = Mn8 at the pixel */
export function retouchPixel(c: number[], b0: ArrayLike<number>, mn: ArrayLike<number>, rB: number, rA: number): number[] {
  if (rB > 0) {
    let [y, cb, cr] = toYcc(c[0], c[1], c[2]);
    const t = smoothstep(TONE.teeth.y[0], TONE.teeth.y[1], y) * (1 - smoothstep(TONE.teeth.cr[0], TONE.teeth.cr[1], cr));
    const k = rB * t;
    cb += Math.max(0, 0.5 - cb) * TONE.teeth.cb * k;
    cr += (0.5 - cr) * TONE.teeth.crPull * k;
    y += TONE.teeth.lift * k * (1 - y);
    [c[0], c[1], c[2]] = fromYcc(y, cb, cr);
  }
  if (rA > 0) {
    const E = TONE.eye;
    let [y, cb, cr] = toYcc(c[0], c[1], c[2]);
    const ch = 2 * Math.hypot(cb - 0.5, cr - 0.5);
    const sc = smoothstep(E.scY[0], E.scY[1], y) * (1 - smoothstep(E.scCh[0], E.scCh[1], ch));
    cb += (0.5 - cb) * E.detint * rA * sc;
    cr += (0.5 - cr) * E.detint * rA * sc;
    y += E.scLift * rA * sc * (1 - y);
    const ir = smoothstep(E.irCh[0], E.irCh[1], ch) * smoothstep(E.irY0[0], E.irY0[1], y) * (1 - smoothstep(E.irY1[0], E.irY1[1], y));
    y += E.irLift * rA * ir;
    [c[0], c[1], c[2]] = fromYcc(y, cb, cr);
    for (let k = 0; k < 3; k++) c[k] += E.clarity * rA * (1 - sc) * Math.min(E.clamp, Math.max(-E.clamp, b0[k] - mn[k]));
  }
  for (let k = 0; k < 3; k++) c[k] = Math.min(1, Math.max(0, c[k]));
  return c;
}

/** P0d at full resolution; `base0` covers the O rectangle `win` (a tile), Δ8 and Mn8 cover the whole O */
export function retouchCpu(base0: Img, field: ToneFieldCpu | null, r: Img, fieldOn: boolean, win: Win = IDENTITY_WIN): Img {
  const out = makeImg(base0.w, base0.h);
  const b0 = [0, 0, 0, 0];
  const dl = [0, 0, 0, 0];
  const mn = [0, 0, 0, 0];
  const rv = [0, 0, 0, 0];
  for (let y = 0; y < base0.h; y++)
    for (let x = 0; x < base0.w; x++) {
      const u = (x + 0.5) / base0.w;
      const v = (y + 0.5) / base0.h;
      const ou = win[0] + u * win[2];
      const ov = win[1] + v * win[3];
      texel(base0, x, y, b0);
      const c = [b0[0], b0[1], b0[2]];
      if (fieldOn && field?.delta8) {
        sample(field.delta8, ou, ov, dl);
        for (let k = 0; k < 3; k++) c[k] += (dl[k] - TONE_ZERO) * 0.5;
      }
      sample(r, u, v, rv);
      if (rv[3] > 0 && field) sample(field.mn8, ou, ov, mn);
      retouchPixel(c, b0, rv[3] > 0 && field ? mn : b0, rv[2], rv[3]);
      out.d.set([c[0], c[1], c[2], 1], (y * base0.w + x) * 4);
    }
  return quantize(out);
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/engine/toneCpu.test.ts && npm run typecheck`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/shaders/tone.ts src/engine/toneCpu.ts src/engine/toneCpu.test.ts
git commit -m "v0.4 step 4 (8/20): TONE table and the CPU reference of the tone field and retouch" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Calibrate `TONE` on the fixture (targets and keeps)

**Files:**
- Create: `src/engine/toneStats.node.ts`, `src/engine/toneCalibration.test.ts`
- Modify (tuning only, if a check fails): `src/engine/shaders/tone.ts` (`TONE` gains), `src/engine/toneStats.node.ts` (`TARGETS`)

**Interfaces:**
- Consumes: Task 7 `generateToneFixture`, Task 5 draw lists, Task 6 `rasterizeTone`, Task 8 `toneFieldCpu`, `retouchCpu`, `sigmaLow`.
- Produces (`src/engine/toneStats.node.ts`, test-only; Task 11's GPU spec reuses it):
  ```ts
  export interface ToneFixtureDefect { kind: 'blemish' | 'blotch' | 'darkCircle' | 'fold' | 'teeth' | 'sclera'; name: string; center: [number, number]; sigma?: number; box: [number, number, number, number]; pixels: [number, number, number][] }
  export interface ToneFixture { source: string; width: number; height: number; fw: number; defects: ToneFixtureDefect[]; regions: { cheek: [number, number, number, number] } }
  export interface Rgba8 { width: number; height: number; data: ArrayLike<number> }
  export type ToolName = 'even' | 'warmUp' | 'warmDown' | 'darkCircle' | 'nasolabial' | 'teeth' | 'eyeBright';
  export const TOOL_VALUES: Record<ToolName, ToneValues>;
  export const TARGETS: { even: number; darkCircle: number; nasolabial: number; teeth: number; eyeBright: number };
  export interface Check { name: string; value: number; ok: boolean; bound: string }
  export function ycc(img: Rgba8, x: number, y: number): [number, number, number];
  export function recovery(out: Rgba8, fix: Rgba8, orig: Rgba8, pixels: readonly [number, number, number][], ch: 0 | 1 | 2, minG?: number): number;
  export function discStats(img: Rgba8, c: readonly [number, number], rad: number): { mean: number; sd: number };
  export function toolChecks(tool: ToolName, out: Rgba8, fix: Rgba8, orig: Rgba8, fx: ToneFixture, face: Face, scale: number): Check[];
  export function renderToneCpu(img: Rgba8, face: Face, v: ToneValues): Rgba8;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/engine/toneCalibration.test.ts`:
```ts
// Calibration of the TONE gains on sample_face_tone.png (skin-cleanup spec §8.2 "Calibration and thresholds"): each tool
// at 100 through toneGeometry → CPU raster → toneCpu must recover its target share of the defect made for it and keep
// every "keeps" bound. A failing check means: tune TONE in ./shaders/tone.ts (plan Task 9, Step 4).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { adapt } from '../tracking/adapter111';
import type { Face } from '../types';
import { renderToneCpu, TOOL_VALUES, toolChecks, type Rgba8, type ToneFixture, type ToolName } from './toneStats.node';

const root = resolve(import.meta.dirname, '../..');
let fix: Rgba8;
let orig: Rgba8;
let fx: ToneFixture;
let face: Face;

beforeAll(async () => {
  const gen = (await import(pathToFileURL(resolve(root, 'scripts/gen-tone-fixture.mjs')).href)) as {
    generateToneFixture(): { png: Buffer; json: ToneFixture };
  };
  const g = gen.generateToneFixture();
  const p = PNG.sync.read(g.png);
  fix = { width: p.width, height: p.height, data: p.data };
  const o = PNG.sync.read(readFileSync(resolve(root, 'tests/fixtures/sample_face.png')));
  orig = { width: o.width, height: o.height, data: o.data };
  fx = g.json;
  const lm = JSON.parse(readFileSync(resolve(root, 'tests/fixtures/landmarks_sample_face.json'), 'utf8')) as { width: number; height: number; points: number[] };
  face = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);
}, 60_000);

describe('TONE calibration on sample_face_tone.png', () => {
  for (const tool of Object.keys(TOOL_VALUES) as ToolName[]) {
    it(`${tool} at 100 reaches its target and keeps every bound`, () => {
      const out = renderToneCpu(fix, face, TOOL_VALUES[tool]);
      const checks = toolChecks(tool, out, fix, orig, fx, face, 1);
      console.log(`${tool}\n${checks.map((c) => `  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name} = ${c.value.toFixed(4)} (${c.bound})`).join('\n')}`);
      expect(checks.filter((c) => !c.ok).map((c) => `${c.name} = ${c.value.toFixed(4)} (${c.bound})`)).toEqual([]);
    }, 60_000);
  }
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/engine/toneCalibration.test.ts`
Expected: FAIL — `Failed to resolve import "./toneStats.node"`.

- [ ] **Step 3: Implement the statistics**

Create `src/engine/toneStats.node.ts`:
```ts
// Test-only (Node): statistics on the 膚質 fixture (skin-cleanup spec §8.2): how much of each synthetic defect a tool
// recovers and the "keeps" bounds, shared by the CPU calibration (toneCalibration.test.ts, scale 1) and the GPU harness
// (tests/e2e/tone-engine.spec.ts, scale ⅔). Images are RGBA8; YCbCr is JPEG full range.
import type { Face } from '../types';
import { faceFrame, fieldActive, IDENTITY_WIN, NEUTRAL_TONE, Q_CLEAR, R_CLEAR, toneDrawsQ, toneDrawsR, warmRingWidth, type ToneValues, type V2 } from './passes/toneGeometry';
import { sigmaLow } from './shaders/tone';
import { fromRgba8, makeImg, retouchCpu, toneFieldCpu, toRgba8, type Img } from './toneCpu';
import { rasterizeTone } from './toneRaster.node';

export interface ToneFixtureDefect {
  kind: 'blemish' | 'blotch' | 'darkCircle' | 'fold' | 'teeth' | 'sclera';
  name: string;
  center: [number, number];
  sigma?: number;
  box: [number, number, number, number];
  pixels: [number, number, number][];
}
export interface ToneFixture {
  source: string;
  width: number;
  height: number;
  fw: number;
  defects: ToneFixtureDefect[];
  regions: { cheek: [number, number, number, number] };
}
export interface Rgba8 {
  width: number;
  height: number;
  data: ArrayLike<number>;
}
export type ToolName = 'even' | 'warmUp' | 'warmDown' | 'darkCircle' | 'nasolabial' | 'teeth' | 'eyeBright';

export const TOOL_VALUES: Record<ToolName, ToneValues> = {
  even: { ...NEUTRAL_TONE, even: 1 },
  warmUp: { ...NEUTRAL_TONE, warmth: 1 },
  warmDown: { ...NEUTRAL_TONE, warmth: 0 },
  darkCircle: { ...NEUTRAL_TONE, darkCircle: 1 },
  nasolabial: { ...NEUTRAL_TONE, nasolabial: 1 },
  teeth: { ...NEUTRAL_TONE, teeth: 1 },
  eyeBright: { ...NEUTRAL_TONE, eyeBright: 1 },
};

/** CPU targets at 100 (S §8.2): 勻膚 Cr excess, 黑眼圈 / 法令紋 Y darkening, 白牙 Cb shift, 亮眼 sclera Cr shift. The GPU asserts ⅔. */
export const TARGETS = { even: 0.5, darkCircle: 0.6, nasolabial: 0.5, teeth: 0.45, eyeBright: 0.45 };

export interface Check {
  name: string;
  value: number;
  ok: boolean;
  bound: string;
}

export function ycc(img: Rgba8, x: number, y: number): [number, number, number] {
  const i = (y * img.width + x) * 4;
  const r = img.data[i] / 255;
  const g = img.data[i + 1] / 255;
  const b = img.data[i + 2] / 255;
  return [0.299 * r + 0.587 * g + 0.114 * b, 0.5 - 0.168736 * r - 0.331264 * g + 0.5 * b, 0.5 + 0.5 * r - 0.418688 * g - 0.081312 * b];
}

/** Σg·(ch(out) − ch(fix)) / Σg·(ch(orig) − ch(fix)) over the defect pixels with g ≥ minG: 1 = gone, 0 = untouched */
export function recovery(out: Rgba8, fix: Rgba8, orig: Rgba8, pixels: readonly [number, number, number][], ch: 0 | 1 | 2, minG = 0): number {
  let num = 0;
  let den = 0;
  for (const [x, y, g] of pixels) {
    if (g < minG) continue;
    const f = ycc(fix, x, y)[ch];
    num += g * (ycc(out, x, y)[ch] - f);
    den += g * (ycc(orig, x, y)[ch] - f);
  }
  return den !== 0 ? num / den : 0;
}

function lumaGrid(img: Rgba8, x0: number, y0: number, w: number, h: number, pad: number): (x: number, y: number) => number {
  const W = w + 2 * pad;
  const g = new Float64Array(W * (h + 2 * pad));
  for (let y = 0; y < h + 2 * pad; y++)
    for (let x = 0; x < W; x++) {
      const px = Math.min(img.width - 1, Math.max(0, x0 - pad + x));
      const py = Math.min(img.height - 1, Math.max(0, y0 - pad + y));
      g[y * W + x] = ycc(img, px, py)[0];
    }
  return (x, y) => g[(y - y0 + pad) * W + (x - x0 + pad)];
}

/** mean |Y − box3(Y)| over a rect */
export function hfEnergy(img: Rgba8, r: { x: number; y: number; w: number; h: number }): number {
  const Y = lumaGrid(img, r.x, r.y, r.w, r.h, 1);
  let s = 0;
  for (let y = r.y; y < r.y + r.h; y++)
    for (let x = r.x; x < r.x + r.w; x++) {
      let b = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) b += Y(x + i, y + j);
      s += Math.abs(Y(x, y) - b / 9);
    }
  return s / (r.w * r.h);
}

/** mean and standard deviation of Y over the disc of radius `rad` (px) around c */
export function discStats(img: Rgba8, c: readonly [number, number], rad: number): { mean: number; sd: number } {
  let s = 0;
  let s2 = 0;
  let n = 0;
  for (let y = Math.floor(c[1] - rad); y <= Math.ceil(c[1] + rad); y++)
    for (let x = Math.floor(c[0] - rad); x <= Math.ceil(c[0] + rad); x++) {
      if (Math.hypot(x + 0.5 - c[0], y + 0.5 - c[1]) > rad) continue;
      const v = ycc(img, x, y)[0];
      s += v;
      s2 += v * v;
      n++;
    }
  const mean = s / n;
  return { mean, sd: Math.sqrt(Math.max(0, s2 / n - mean * mean)) };
}

function ringMean(img: Rgba8, c: readonly [number, number], r0: number, r1: number): number {
  let s = 0;
  let n = 0;
  for (let y = Math.floor(c[1] - r1); y <= Math.ceil(c[1] + r1); y++)
    for (let x = Math.floor(c[0] - r1); x <= Math.ceil(c[0] + r1); x++) {
      const d = Math.hypot(x + 0.5 - c[0], y + 0.5 - c[1]);
      if (d < r0 || d > r1) continue;
      s += ycc(img, x, y)[0];
      n++;
    }
  return s / n;
}

/** a blemish's contrast: mean Y of the ring [2σ, 3σ] minus mean Y of the disc σ */
export function blobContrast(img: Rgba8, c: readonly [number, number], sigma: number): number {
  return ringMean(img, c, 2 * sigma, 3 * sigma) - discStats(img, c, sigma).mean;
}

/** RMS of Y − box5(Y) in a disc */
function detailRms(img: Rgba8, c: readonly [number, number], rad: number): number {
  const x0 = Math.floor(c[0] - rad);
  const y0 = Math.floor(c[1] - rad);
  const n = Math.ceil(2 * rad) + 1;
  const Y = lumaGrid(img, x0, y0, n, n, 2);
  let s = 0;
  let k = 0;
  for (let y = y0; y < y0 + n; y++)
    for (let x = x0; x < x0 + n; x++) {
      if (Math.hypot(x + 0.5 - c[0], y + 0.5 - c[1]) > rad) continue;
      let b = 0;
      for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) b += Y(x + i, y + j);
      s += (Y(x, y) - b / 25) ** 2;
      k++;
    }
  return Math.sqrt(s / k);
}

export function inPoly(p: V2, poly: readonly V2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** the polygon pushed out radially from its centroid by d px */
function grow(poly: readonly V2[], d: number): V2[] {
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  return poly.map(([x, y]) => {
    const l = Math.hypot(x - cx, y - cy) || 1;
    return [x + ((x - cx) / l) * d, y + ((y - cy) / l) * d];
  });
}
const pts = (face: Face, idx: readonly number[], W: number, H: number): V2[] => idx.map((i) => [face.pts111[i * 2] * W, face.pts111[i * 2 + 1] * H]);
const ovalPx = (face: Face, W: number, H: number): V2[] => Array.from({ length: face.oval.length / 2 }, (_, i): V2 => [face.oval[i * 2] * W, face.oval[i * 2 + 1] * H]);

/** the largest channel difference (0..255) over pixels the predicate excludes */
function maxDiff(a: Rgba8, b: Rgba8, count: (x: number, y: number) => boolean): number {
  let m = 0;
  for (let y = 0; y < a.height; y++)
    for (let x = 0; x < a.width; x++) {
      if (!count(x, y)) continue;
      const i = (y * a.width + x) * 4;
      for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(a.data[i + c] - b.data[i + c]));
    }
  return m;
}

const EYE_L = [52, 53, 72, 54, 55, 56, 73, 57];
const EYE_R = [58, 59, 75, 60, 61, 62, 76, 63];
const INNER_LIP = [96, 97, 98, 99, 100, 101, 102, 103];
const OUTER_LIP = [84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95];

/** every check of one tool at 100 (S §8.2 case 2); `scale` multiplies the targets: 1 for the CPU, ⅔ for the GPU */
export function toolChecks(tool: ToolName, out: Rgba8, fix: Rgba8, orig: Rgba8, fx: ToneFixture, face: Face, scale: number): Check[] {
  const W = fix.width;
  const H = fix.height;
  const aspect = W / H;
  const fr = faceFrame(face, aspect);
  const fwPx = fr.fw * W;
  const checks: Check[] = [];
  const atLeast = (name: string, value: number, min: number) => checks.push({ name, value, ok: value >= min, bound: `≥ ${min.toFixed(3)}` });
  const atMost = (name: string, value: number, max: number) => checks.push({ name, value, ok: value <= max, bound: `≤ ${max}` });
  const kind = (k: ToneFixtureDefect['kind']) => fx.defects.filter((d) => d.kind === k);
  const outside = (poly: readonly V2[]) => (x: number, y: number) => !inPoly([x + 0.5, y + 0.5], poly);
  const oval = ovalPx(face, W, H);
  const [cx, cy, cw, ch] = fx.regions.cheek;
  const cheek = { x: cx, y: cy, w: cw, h: ch };
  const meanCh = (img: Rgba8, c: 0 | 1 | 2) => {
    let s = 0;
    for (let y = cy; y < cy + ch; y++) for (let x = cx; x < cx + cw; x++) s += ycc(img, x, y)[c];
    return s / (cw * ch);
  };
  switch (tool) {
    case 'even': {
      for (const d of kind('blotch')) atLeast(`${d.name} Cr recovery`, recovery(out, fix, orig, d.pixels, 2), TARGETS.even * scale);
      const hf = hfEnergy(out, cheek) / hfEnergy(fix, cheek);
      checks.push({ name: 'cheek HF energy ratio', value: hf, ok: hf >= 0.9 && hf <= 1.1, bound: '0.9 … 1.1' });
      for (const d of kind('blemish')) atLeast(`${d.name} contrast kept`, blobContrast(out, d.center, d.sigma ?? 5) / blobContrast(fix, d.center, d.sigma ?? 5), 0.8);
      atMost('max diff outside oval + 0.10 fw', maxDiff(out, fix, outside(grow(oval, 0.1 * fwPx))), 1);
      break;
    }
    case 'warmUp':
    case 'warmDown': {
      const dCb = meanCh(out, 1) - meanCh(fix, 1);
      if (tool === 'warmUp') atMost('cheek ΔCb', dCb, -0.008);
      else atLeast('cheek ΔCb', dCb, 0.008);
      atMost('cheek |ΔY| / Y', Math.abs(meanCh(out, 0) - meanCh(fix, 0)) / meanCh(fix, 0), 0.01);
      const wT = warmRingWidth(face, aspect, null) * W;
      atMost('max diff outside oval + w_T + 0.02 fw', maxDiff(out, fix, outside(grow(oval, wT + 0.02 * fwPx))), 1);
      break;
    }
    case 'darkCircle': {
      for (const d of kind('darkCircle')) atLeast(`${d.name} Y recovery (core)`, recovery(out, fix, orig, d.pixels, 0, 0.9), TARGETS.darkCircle * scale);
      for (const [side, lid] of [['L', [57, 73, 56]], ['R', [62, 76, 63]]] as const) {
        const w = fr.eyeW[side] * W;
        const below = (p: V2): [number, number] => [p[0] + fr.yhat[0] * 0.12 * w, p[1] + fr.yhat[1] * 0.12 * w];
        const lids = pts(face, lid, W, H);
        const contrast = (img: Rgba8) => lids.reduce((s, p) => s + discStats(img, below(p), 3).mean - discStats(img, p, 2).mean, 0) / lids.length;
        atLeast(`lash line ${side} contrast kept`, contrast(out) / contrast(fix), 0.8);
      }
      atMost('max diff outside oval + 0.10 fw', maxDiff(out, fix, outside(grow(oval, 0.1 * fwPx))), 1);
      break;
    }
    case 'nasolabial': {
      for (const d of kind('fold')) atLeast(`${d.name} Y recovery (core)`, recovery(out, fix, orig, d.pixels, 0, 0.9), TARGETS.nasolabial * scale);
      atMost('max diff outside oval + 0.10 fw', maxDiff(out, fix, outside(grow(oval, 0.1 * fwPx))), 1);
      break;
    }
    case 'teeth': {
      for (const d of kind('teeth')) atLeast('teeth Cb recovery', recovery(out, fix, orig, d.pixels, 1), TARGETS.teeth * scale);
      const inner = pts(face, INNER_LIP, W, H);
      const outer = pts(face, OUTER_LIP, W, H);
      atMost('lips max diff', maxDiff(out, fix, (x, y) => inPoly([x + 0.5, y + 0.5], outer) && !inPoly([x + 0.5, y + 0.5], inner)), 2);
      atMost('max diff outside mouth + 0.06 mouthW', maxDiff(out, fix, outside(grow(inner, 0.06 * fr.mouthW * W))), 1);
      break;
    }
    case 'eyeBright': {
      for (const d of kind('sclera')) atLeast(`${d.name} Cr recovery`, recovery(out, fix, orig, d.pixels, 2), TARGETS.eyeBright * scale);
      for (const [side, i] of [['L', 104], ['R', 105]] as const) {
        const c: [number, number] = [face.pts111[i * 2] * W, face.pts111[i * 2 + 1] * H];
        const rad = 0.18 * fr.eyeW[side] * W;
        atLeast(`iris ${side} detail ratio`, detailRms(out, c, rad) / detailRms(fix, c, rad), 1.1);
      }
      const eyes = [grow(pts(face, EYE_L, W, H), 0.06 * fr.eyeW.L * W), grow(pts(face, EYE_R, W, H), 0.06 * fr.eyeW.R * W)];
      atMost('max diff outside the eyes + 0.06 eyeW', maxDiff(out, fix, (x, y) => !eyes.some((p) => inPoly([x + 0.5, y + 0.5], p))), 1);
      break;
    }
  }
  return checks;
}

/** P0c + P0d on the CPU for one face, deciding the passes as the engine's tone job does (Task 11) */
export function renderToneCpu(img: Rgba8, face: Face, v: ToneValues): Rgba8 {
  const W = img.width;
  const H = img.height;
  const aspect = W / H;
  const faces = [{ face, values: v, weight: 1, cap: null }];
  const qw = Math.ceil(W / 4);
  const qh = Math.ceil(H / 4);
  const fieldOn = fieldActive(v);
  const r: Img = { w: qw, h: qh, d: rasterizeTone(toneDrawsR(faces, aspect), qw, qh, IDENTITY_WIN, R_CLEAR) };
  const q: Img = fieldOn ? { w: qw, h: qh, d: rasterizeTone(toneDrawsQ(faces, aspect), qw, qh, IDENTITY_WIN, Q_CLEAR) } : makeImg(qw, qh);
  const base = fromRgba8(W, H, img.data);
  const sl = sigmaLow(faceFrame(face, aspect).fw * W, Math.min(W, H));
  const field = fieldOn || v.eyeBright > 0 ? toneFieldCpu(base, q, r, sl, fieldOn) : null;
  return { width: W, height: H, data: toRgba8(retouchCpu(base, field, r, fieldOn)) };
}
```

- [ ] **Step 4: Run the calibration and tune `TONE` until every check passes**

Run: `npx vitest run src/engine/toneCalibration.test.ts`
Expected (first run): the log prints a table per tool; some lines may read `FAIL`.

Tuning rules, applied one tool at a time and re-running after each change (all edits in `TONE`, `src/engine/shaders/tone.ts`):
- a **recovery** below its target: raise that tool's main gain in 10 % steps — 勻膚 `even.chroma`, 黑眼圈 `darkCircle.lift`, 法令紋 `nasolabial.lift`, 白牙 `teeth.cb`, 亮眼 `eye.detint` — up to 2× its starting value;
- a **keep** broken (HF energy, blemish or lash contrast, lips, iris detail, outside ≤ 1/255): lower the gain that broke it by 10 % steps, or narrow its guard (`evenGuard`, `darkGuard` upper edge −0.02 per step);
- if a target still cannot be met inside those bounds without breaking a keep, set that entry of `TARGETS` (`src/engine/toneStats.node.ts`) to the best value reached, rounded down to 0.05 (S §9 risk row: "the harness thresholds follow the tuned values"), and record it.

Expected (final run): `7 passed`. Then run `npx vitest run src/engine/toneCpu.test.ts` again — it must still pass (the synthetic tests bound the gains).

- [ ] **Step 5: Commit**

```bash
npx vitest run src/engine/toneCalibration.test.ts 2>&1 | grep -E "^(even|warmUp|warmDown|darkCircle|nasolabial|teeth|eyeBright)$|^  (ok|FAIL) " > .superpowers/step4-calibration.txt
git diff --stat -- src/engine/shaders/tone.ts src/engine/toneStats.node.ts >> .superpowers/step4-calibration.txt
git add src/engine/toneStats.node.ts src/engine/toneCalibration.test.ts src/engine/shaders/tone.ts
git commit -m "v0.4 step 4 (9/20): calibrate TONE on the 膚質 fixture" -m "$(cat .superpowers/step4-calibration.txt)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
(The body carries the final calibration table; any `TONE` gain or `TARGETS` entry changed in Step 4 shows in the diff of this commit.)

---

### Task 10: Ping-pong the two full-size buffers

**Files:**
- Modify: `src/engine/pipeline.ts` (CRLF; new helper next to `fb()`, `pipeline.ts:340-350`; the makeup target, `pipeline.ts:460`; the reshape target, `pipeline.ts:474`)
- Test: `src/engine/pipeline.test.ts`

**Interfaces:**
- Consumes: `fb(name, size)`, `fbs` (`pipeline.ts:340-350`); step 3's per-pass sizes (`job.srcSize` for O passes, `job.size` for P2; crop spec §4.1, §4.3).
- Produces:
  ```ts
  export function pickFull(prefer: 'A' | 'B', input: 'A' | 'B' | null): 'A' | 'B';
  // inside createPipeline: full(prefer: 'A' | 'B', input: Framebuffer | null, size: Size): Framebuffer
  ```
  Rule (S §4.1): each full-size pass writes its preferred buffer unless that buffer is its input. Heal prefers A, retouch B, makeup A, reshape B — with every pass on: P0b src→A, P0d A→B, P1 B→A, P2 A→B, composite reads B, capture writes A. Without the step-4 passes this is exactly today's choice (makeup → A, reshape → B).

- [ ] **Step 1: Write the failing test**

Append to `src/engine/pipeline.test.ts` (add `pickFull` to its import from `./pipeline`):
```ts
describe('pickFull (skin-cleanup spec §4.1 ping-pong)', () => {
  it('a pass writes its preferred buffer unless that buffer is its input', () => {
    expect(pickFull('A', null)).toBe('A');
    expect(pickFull('B', null)).toBe('B');
    expect(pickFull('A', 'A')).toBe('B');
    expect(pickFull('B', 'A')).toBe('B');
    expect(pickFull('B', 'B')).toBe('A');
    expect(pickFull('A', 'B')).toBe('A');
  });

  it('every pass on: P0b src→A, P0d A→B, P1 B→A, P2 A→B; the capture then takes A', () => {
    let cur: 'A' | 'B' | null = null;
    const chain = (['A', 'B', 'A', 'B'] as const).map((prefer) => (cur = pickFull(prefer, cur)));
    expect(chain).toEqual(['A', 'B', 'A', 'B']);
    expect(cur === 'A' ? 'B' : 'A').toBe('A');
  });

  it('no step-4 pass: makeup still writes A and reshape B, as v0.3 does', () => {
    expect(pickFull('A', null)).toBe('A');
    expect(pickFull('B', 'A')).toBe('B');
    expect(pickFull('B', null)).toBe('B');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/engine/pipeline.test.ts`
Expected: FAIL — `pickFull is not a function`.

- [ ] **Step 3: Implement**

In `src/engine/pipeline.ts`, above `createPipeline` (after `bodyUploadNeeded`, `pipeline.ts:312-321`):
```ts
/**
 * Which full-size buffer a pass writes (skin-cleanup spec §4.1): its preferred one, unless that is its input. Heal and
 * makeup prefer A, retouch and reshape prefer B, so a frame never adds a third full-size buffer.
 */
export function pickFull(prefer: 'A' | 'B', input: 'A' | 'B' | null): 'A' | 'B' {
  return input === prefer ? (prefer === 'A' ? 'B' : 'A') : prefer;
}
```
Inside `createPipeline`, right after `fb()`:
```ts
  const fullName = (f: Framebuffer | null): 'A' | 'B' | null => (f !== null && f === fbs.A ? 'A' : f !== null && f === fbs.B ? 'B' : null);
  /** the full-size buffer a pass writes (pickFull), sized for that pass */
  function full(prefer: 'A' | 'B', input: Framebuffer | null, size: Size): Framebuffer {
    return fb(pickFull(prefer, fullName(input)), size);
  }
```
Then in `run()`:
- the makeup target `const a = fb('A', job.srcSize);` (`pipeline.ts:460`) becomes `const a = full('A', baseFb, job.srcSize);` (P1 renders at the source size, crop spec §4.2);
- the reshape target `const b = fb('B', job.size);` (`pipeline.ts:474`) becomes `const b = full('B', baseFb, job.size);` (P2 renders at the V size, crop spec §4.3).
The capture rule (`pipeline.ts:500-502`, "whichever full-size buffer is not the composite input") stays as it is.

- [ ] **Step 4: Run the tests and the existing engine checks**

Run: `npx vitest run src/engine && npm run typecheck`
Expected: PASS.
Run: `npm run build && npx playwright test tests/e2e/engine.spec.ts tests/e2e/parity.spec.ts tests/e2e/reshape.spec.ts`
Expected: all pass — the pixels are unchanged (without step-4 passes the buffers chosen are v0.3's).

- [ ] **Step 5: Commit**

```bash
git add src/engine/pipeline.ts src/engine/pipeline.test.ts
git commit -m "v0.4 step 4 (10/20): ping-pong the two full-size buffers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Tone field P0c and retouch P0d on the GPU, with the field cache

**Files:**
- Modify: `src/engine/shaders/tone.ts` (GLSL)
- Create: `src/engine/passes/toneField.ts`, `src/engine/toneJob.ts`, `src/engine/toneJob.test.ts`
- Modify: `src/engine/pipeline.ts` (CRLF; `FrameJob` `:79-122`, `FrameResult` `:124-128`, `FbName` `:246`, `run()` `:433-539`, step 3's `releaseBuffers` `:562-565`, `dispose()` `:573-590`), `src/engine/index.ts` (CRLF; `job()` `:300-354`, `render()` `:384-397`), `src/types.ts:466-519` (CRLF; `RenderInput.toneSource`, `RenderStats.toneBuilt`), `src/app/still.ts` (`flush()` `:188-207`: debug `passes`, `toneBuilds`)
- Test: `src/engine/toneCpu.test.ts` (hash pin), `tests/e2e/pages/tone.ts`, `tests/e2e/tone-engine.spec.ts`

**Interfaces:**
- Consumes: Tasks 5, 6, 8, 9, 10; step 1 `RenderInput.faces: RenderFace[]` (`face`, `weight`, `person.values`), `job()`'s `listed` / `faces: FrameFace[]` (`centre`, `presence`) and `input.obstacles` (step-1 plan Task 18), `capsFor(centres, obstacles, aspect, presence)` (step-1 plan Task 16; iso, −1 = none), `defaultPhoto`, `neutralPerson`; step 2 `shaderHash` (`src/engine/shaderHash.ts`); step 3 `FrameJob.win`, `srcSize`, `oAspect`, `Engine.releaseBuffers`.
- Produces:
  ```ts
  // src/types.ts
  // RenderInput gains: toneSource?: { source: TexImageSource; width: number; height: number };
  // RenderStats gains: toneBuilt?: boolean;  // the tone field was rebuilt by this frame
  // src/engine/toneJob.ts
  export interface ToneJob {
    spots: readonly Spot[]; drawsR: readonly ToneDraw[]; drawsQ: readonly ToneDraw[];
    fieldOn: boolean; mn8On: boolean; retouchOn: boolean; key: string; work: Size; sigmaLowPx: number;
  }
  export interface ToneJobFace { face: Face; weight: number; values: Readonly<Partial<Record<ParamId, number>>>; cap: ToneCap | null }
  export function objectId(o: object): number;
  export function spotsKey(spots: readonly Spot[]): string;
  export function buildToneJob(i: { faces: readonly ToneJobFace[]; spots: readonly Spot[]; aspect: number; work: Size; sourceId: number }): ToneJob | null;
  // src/engine/passes/toneField.ts
  export type FieldFbName = 'D8' | 'T8' | 'L' | 'Lt' | 'Delta8';
  export interface ToneFieldTextures { mn8: Texture; delta8: Texture | null }
  export function createToneFieldPass(gl: GL): { build(base0, size, q, r, sigmaLowPx, fieldOn, fb): ToneFieldTextures; dispose(): void };
  export function createRetouchPass(gl: GL): { draw(base0, dst, delta8 | null, mn8 | null, r, win, fieldOn): void; dispose(): void };
  // pipeline: FrameJob.tone: ToneJob | null; FrameResult.toneBuilt: boolean; passes gain 'toneField', 'retouch'
  // tests/e2e/pages/tone.ts: window.runToneField(), window.runToneEngine(); helpers fixtureBitmap(), inputFor(), toPng()
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/engine/toneJob.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { adapt } from '../tracking/adapter111';
import type { Spot } from '../types';
import { buildToneJob, objectId, type ToneJobFace } from './toneJob';

const lm = JSON.parse(readFileSync(new URL('../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as { width: number; height: number; points: number[] };
const face = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);
const work = { width: 1000, height: 1500 };
const f = (values: Record<string, number>): ToneJobFace[] => [{ face, weight: 1, values, cap: null }];
const job = (values: Record<string, number>, spots: Spot[] = [], src: object = work) => buildToneJob({ faces: f(values), spots, aspect: 1000 / 1500, work, sourceId: objectId(src) });

describe('buildToneJob (skin-cleanup spec §4.1, §4.3 cache)', () => {
  it('neutral tone and no spots: no job, so the frame equals step 3', () => {
    expect(job({ 'tone.warmth': 0.5, 'shape.faceSlim': 0.6 })).toBeNull();
  });

  it('decides the passes per tool', () => {
    expect(job({ 'tone.even': 0.5 })).toMatchObject({ fieldOn: true, mn8On: true, retouchOn: true });
    expect(job({ 'tone.warmth': 0.3 })).toMatchObject({ fieldOn: true, mn8On: true, retouchOn: true });
    expect(job({ 'tone.teeth': 0.5 })).toMatchObject({ fieldOn: false, mn8On: false, retouchOn: true });
    expect(job({ 'tone.eyeBright': 0.5 })).toMatchObject({ fieldOn: false, mn8On: true, retouchOn: true });
    expect(job({}, [{ x: 0.5, y: 0.5, r: 0.02, dx: 0, dy: 0, owner: null }])).toMatchObject({ fieldOn: false, retouchOn: false });
  });

  it('a 瘦臉, 白牙 or 亮眼-amount change keeps the key; a 勻膚 or 黑眼圈 change or a new spot rebuilds', () => {
    const k = job({ 'tone.even': 0.5, 'tone.eyeBright': 0.3 })!.key;
    expect(job({ 'tone.even': 0.5, 'tone.eyeBright': 0.3, 'shape.faceSlim': 1 })!.key).toBe(k);
    expect(job({ 'tone.even': 0.5, 'tone.eyeBright': 0.9, 'tone.teeth': 1 })!.key).toBe(k);
    expect(job({ 'tone.even': 0.51, 'tone.eyeBright': 0.3 })!.key).not.toBe(k);
    expect(job({ 'tone.even': 0.5, 'tone.eyeBright': 0.3, 'tone.darkCircle': 0.2 })!.key).not.toBe(k);
    expect(job({ 'tone.even': 0.5, 'tone.eyeBright': 0.3 }, [{ x: 0.3, y: 0.3, r: 0.02, dx: 0.05, dy: 0, owner: null }])!.key).not.toBe(k);
  });

  it('two photos of the same size never share a field (Review Focus 5)', () => {
    const a = { name: 'bitmap a' };
    const b = { name: 'bitmap b' };
    expect(job({ 'tone.even': 0.5 }, [], a)!.key).not.toBe(job({ 'tone.even': 0.5 }, [], b)!.key);
    expect(job({ 'tone.even': 0.5 }, [], a)!.key).toBe(job({ 'tone.even': 0.5 }, [], a)!.key);
  });

  it('σ_low follows the largest edited face', () => {
    expect(job({ 'tone.even': 1 })!.sigmaLowPx).toBeCloseTo(0.08 * 588.8, 0);
  });
});
```
Append to `src/engine/toneCpu.test.ts` (move the two imports up to the file's other imports):
```ts
import { shaderHash } from './shaderHash';
import { RETOUCH_FS, TONE_BLUR_FS, TONE_DOWN8_FS, TONE_FIELD_FS, TONE_LBOX_FS } from './shaders/tone';

describe('tone shaders pin', () => {
  it('is pinned to the shader text and the TONE table: a change must be mirrored in toneCpu.ts (then update this hash)', () => {
    expect(shaderHash([TONE_DOWN8_FS, TONE_BLUR_FS, TONE_LBOX_FS, TONE_FIELD_FS, RETOUCH_FS].join('\n'))).toBe('00000000');
  });
});
```
(The value `'00000000'` is replaced in Step 4 by the hash the first run prints.)

Add to `tests/e2e/pages/tone.ts` (new imports at the top of the file, code at the bottom):
```ts
import { createEngine } from '../../../src/engine/index';
import { createTexture, resizeFramebuffer, uploadSource } from '../../../src/engine/gl/gl';
import { createRetouchPass, createToneFieldPass } from '../../../src/engine/passes/toneField';
import { faceFrame } from '../../../src/engine/passes/toneGeometry';
import { neutralValue, paramDef } from '../../../src/engine/params';
import { sigmaLow } from '../../../src/engine/shaders/tone';
import { defaultPhoto, neutralPerson } from '../../../src/edit/state';
import type { ParamId, PersonParams, PhotoParams, RenderInput, Spot } from '../../../src/types';

export async function fixtureBitmap(): Promise<ImageBitmap> {
  const blob = await (await fetch('/tests/fixtures/sample_face_tone.png')).blob();
  return createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
}

export function toPng(img: ImageData): string {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

/** every photo value neutral (no 美白, 銳化, 濾鏡 or 調節), no geometry change, these spots */
export function neutralPhoto(spots: Spot[] = []): PhotoParams {
  const p = defaultPhoto();
  const values = { ...p.values };
  for (const id of Object.keys(values) as (keyof typeof values)[]) values[id] = neutralValue(paramDef(id as ParamId));
  return { ...p, values, filterId: 'none', spots };
}

export function personWith(v: ToneValues, extra: Partial<Record<ParamId, number>> = {}): PersonParams {
  const p = neutralPerson();
  return {
    ...p,
    values: {
      ...p.values,
      'tone.even': v.even,
      'tone.warmth': v.warmth,
      'tone.darkCircle': v.darkCircle,
      'tone.nasolabial': v.nasolabial,
      'tone.teeth': v.teeth,
      'tone.eyeBright': v.eyeBright,
      ...extra,
    },
  };
}

export function inputFor(bmp: ImageBitmap, v: ToneValues, spots: Spot[] = [], extra: Partial<Record<ParamId, number>> = {}): RenderInput {
  return {
    source: bmp,
    width: bmp.width,
    height: bmp.height,
    faces: [{ face: FACE, weight: 1, person: personWith(v, extra), protect: null }],
    obstacles: [],
    globalSkin: null,
    photo: neutralPhoto(spots),
  };
}

export interface ToneFieldRun {
  w: number;
  h: number;
  qw: number;
  qh: number;
  sigmaLowPx: number;
  err: number;
  levels: { level: number; R: string; Q: string; out: string }[];
}

declare global {
  interface Window {
    runToneField?: () => Promise<ToneFieldRun>;
    runToneEngine?: () => Promise<{ png: Record<string, string>; passes: Record<string, string[]>; built: boolean[]; lossMaxDiff: number }>;
  }
}

/** the raw passes (R, Q, field, retouch) at levels 0.5 and 1 of every tool, read back for the CPU comparison */
window.runToneField = async () => {
  const gl = glOf();
  const bmp = await fixtureBitmap();
  const src = createTexture(gl, 0, 0);
  uploadSource(gl, src, bmp, bmp.width, bmp.height);
  const masks = createToneMaskPass(gl);
  const field = createToneFieldPass(gl);
  const retouch = createRetouchPass(gl);
  const qw = Math.ceil(W / 4);
  const qh = Math.ceil(H / 4);
  const r = createFramebuffer(gl, qw, qh);
  const q = createFramebuffer(gl, qw, qh);
  const out = createFramebuffer(gl, W, H);
  const fbs = new Map<string, Framebuffer>();
  const fbFor = (name: string, s: { width: number; height: number }): Framebuffer => {
    let f = fbs.get(name);
    if (!f) fbs.set(name, (f = createFramebuffer(gl, s.width, s.height)));
    else resizeFramebuffer(gl, f, s.width, s.height);
    return f;
  };
  const sl = sigmaLow(faceFrame(FACE, ASPECT).fw * W, Math.min(W, H));
  const levels: ToneFieldRun['levels'] = [];
  for (const level of [0.5, 1]) {
    const v: ToneValues = { even: level, warmth: 0.5 + level / 2, darkCircle: level, nasolabial: level, teeth: level, eyeBright: level };
    masks.draw(r, toneDrawsR(oneFace(v), ASPECT), IDENTITY_WIN, R_CLEAR);
    masks.draw(q, toneDrawsQ(oneFace(v), ASPECT), IDENTITY_WIN, Q_CLEAR);
    const t = field.build(src, { width: W, height: H }, q.tex, r.tex, sl, true, fbFor);
    retouch.draw(src, out, t.delta8, t.mn8, r.tex, IDENTITY_WIN, true);
    levels.push({ level, R: b64(readFb(gl, r)), Q: b64(readFb(gl, q)), out: b64(readFb(gl, out)) });
  }
  const err = gl.getError();
  masks.dispose();
  field.dispose();
  retouch.dispose();
  bmp.close();
  return { w: W, h: H, qw, qh, sigmaLowPx: sl, err, levels };
};

/** the real engine: each tool at 100 (PNG), the pass lists, the field cache and a context loss */
window.runToneEngine = async () => {
  const bmp = await fixtureBitmap();
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const engine = createEngine(canvas, { mirror: false });
  await engine.ready;
  const tools: Record<string, ToneValues> = {
    base: NEUTRAL_TONE,
    even: { ...NEUTRAL_TONE, even: 1 },
    warmUp: { ...NEUTRAL_TONE, warmth: 1 },
    warmDown: { ...NEUTRAL_TONE, warmth: 0 },
    darkCircle: { ...NEUTRAL_TONE, darkCircle: 1 },
    nasolabial: { ...NEUTRAL_TONE, nasolabial: 1 },
    teeth: { ...NEUTRAL_TONE, teeth: 1 },
    eyeBright: { ...NEUTRAL_TONE, eyeBright: 1 },
  };
  const png: Record<string, string> = {};
  const passes: Record<string, string[]> = {};
  for (const [name, v] of Object.entries(tools)) {
    passes[name] = engine.render(inputFor(bmp, v), { still: true }).passes;
    png[name] = toPng(engine.renderToImageData(inputFor(bmp, v), { mirror: false }));
  }
  const dark = tools.darkCircle;
  const built = [
    engine.render(inputFor(bmp, tools.even), { still: true }).toneBuilt === true, // another key: rebuilt
    engine.render(inputFor(bmp, tools.even), { still: true }).toneBuilt === true, // same key: cached
    engine.render(inputFor(bmp, tools.even, [], { 'shape.faceSlim': 1 }), { still: true }).toneBuilt === true, // 瘦臉: cached
  ];
  const before = engine.renderToImageData(inputFor(bmp, dark), { mirror: false });
  const lose = (canvas.getContext('webgl2') as WebGL2RenderingContext).getExtension('WEBGL_lose_context')!;
  lose.loseContext();
  for (let i = 0; i < 100 && !engine.lost; i++) await new Promise((r) => setTimeout(r, 10));
  lose.restoreContext();
  for (let i = 0; i < 200 && engine.lost; i++) await new Promise((r) => setTimeout(r, 10));
  await engine.ready;
  built.push(engine.render(inputFor(bmp, dark), { still: true }).toneBuilt === true); // after the loss: rebuilt
  const after = engine.renderToImageData(inputFor(bmp, dark), { mirror: false });
  let lossMaxDiff = 0;
  for (let i = 0; i < before.data.length; i++) lossMaxDiff = Math.max(lossMaxDiff, Math.abs(before.data[i] - after.data[i]));
  engine.dispose();
  bmp.close();
  return { png, passes, built, lossMaxDiff };
};
```
(Add `NEUTRAL_TONE` and `type ToneValues` to the existing `toneGeometry` import if they are not there yet.)

Append to `tests/e2e/tone-engine.spec.ts` (new imports at the top):
```ts
import { PNG } from 'pngjs';
import { fromRgba8, retouchCpu, toneFieldCpu, toRgba8, type Img } from '../../src/engine/toneCpu';
import { TOOL_VALUES, toolChecks, type Rgba8, type ToneFixture, type ToolName } from '../../src/engine/toneStats.node';
import { decodeDataUrl } from './fixtures';
```
```ts
const FIXTURE_PNG = resolve(import.meta.dirname, '../fixtures/sample_face_tone.png');
const loadFx = () => JSON.parse(readFileSync(resolve(import.meta.dirname, '../fixtures/sample_face_tone.json'), 'utf8')) as ToneFixture;
const fixturePixels = (): Rgba8 => {
  const p = PNG.sync.read(readFileSync(FIXTURE_PNG));
  return { width: p.width, height: p.height, data: p.data };
};
const imgOf = (w: number, h: number, s: string): Img => fromRgba8(w, h, bytes(s));

test('tone field + retouch: the GPU equals toneCpu (max 2/255, mean 0.25/255) on six crops', async ({ page }) => {
  await openHarness(page, 'runToneField');
  const r = await page.evaluate(() => window.runToneField!());
  expect(r.err).toBe(0);
  const fx = loadFx();
  const src = fixturePixels();
  const base = fromRgba8(src.width, src.height, src.data);
  const centre = (name: string) => fx.defects.find((d) => d.name === name)!.center;
  const crops: [string, [number, number]][] = [
    ['cheek', [fx.regions.cheek[0] + 24, fx.regions.cheek[1] + 24]],
    ['crescent L', centre('darkL')],
    ['crescent R', centre('darkR')],
    ['band', centre('foldL')],
    ['mouth', centre('teeth')],
    ['eye', centre('scleraL')],
  ];
  for (const lv of r.levels) {
    const R = imgOf(r.qw, r.qh, lv.R);
    const Q = imgOf(r.qw, r.qh, lv.Q);
    const cpu = toRgba8(retouchCpu(base, toneFieldCpu(base, Q, R, r.sigmaLowPx, true), R, true));
    const gpu = bytes(lv.out);
    for (const [name, [cx, cy]] of crops) {
      let max = 0;
      let sum = 0;
      let n = 0;
      for (let y = Math.round(cy) - 32; y < Math.round(cy) + 32; y++)
        for (let x = Math.round(cx) - 32; x < Math.round(cx) + 32; x++)
          for (let c = 0; c < 3; c++) {
            const d = Math.abs(gpu[(y * r.w + x) * 4 + c] - cpu[(y * r.w + x) * 4 + c]);
            max = Math.max(max, d);
            sum += d;
            n++;
          }
      console.log(`level ${lv.level} ${name}: max ${max}, mean ${(sum / n).toFixed(3)}`);
      expect(max, `${lv.level} ${name}`).toBeLessThanOrEqual(2);
      expect(sum / n, `${lv.level} ${name}`).toBeLessThanOrEqual(0.25);
    }
  }
});

test('tone engine: each tool changes only its region (⅔ of the calibrated targets), passes, cache, context loss', async ({ page }) => {
  await openHarness(page, 'runToneEngine');
  const r = await page.evaluate(() => window.runToneEngine!());
  const fx = loadFx();
  const orig = (() => {
    const p = PNG.sync.read(readFileSync(resolve(import.meta.dirname, '../fixtures/sample_face.png')));
    return { width: p.width, height: p.height, data: p.data };
  })();
  const base = decodeDataUrl(r.png.base);
  for (const tool of Object.keys(TOOL_VALUES) as ToolName[]) {
    const checks = toolChecks(tool, decodeDataUrl(r.png[tool]), base, orig, fx, FACE, 2 / 3);
    console.log(`${tool}: ${checks.map((c) => `${c.ok ? '' : '✗ '}${c.name} ${c.value.toFixed(3)}`).join(' · ')}`);
    expect(checks.filter((c) => !c.ok).map((c) => `${c.name} = ${c.value.toFixed(4)} (${c.bound})`), tool).toEqual([]);
  }
  const step4 = (p: string[]) => p.filter((x) => x === 'heal' || x === 'toneField' || x === 'retouch');
  expect(step4(r.passes.base)).toEqual([]);
  expect(step4(r.passes.even)).toEqual(['toneField', 'retouch']);
  expect(step4(r.passes.teeth)).toEqual(['retouch']);
  expect(step4(r.passes.eyeBright)).toEqual(['toneField', 'retouch']);
  expect(r.built).toEqual([true, false, false, true]);
  expect(r.lossMaxDiff).toBeLessThanOrEqual(1);
});
```
- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/engine/toneJob.test.ts src/engine/toneCpu.test.ts`
Expected: FAIL — `Failed to resolve import "./toneJob"`, and the pin test fails importing the GLSL names.

- [ ] **Step 3: Implement**

Append to `src/engine/shaders/tone.ts`:
```ts
import { TONE_ZERO } from '../passes/toneGeometry';

const T = TONE;
const E = TONE.eye;
const g = glf;
const v3 = (a: readonly number[]) => `vec3(${a.map(glf).join(', ')})`;

const COMMON = /* glsl */ `
const vec3 L709 = vec3(0.2126, 0.7152, 0.0722);
const float ZERO = ${g(TONE_ZERO)};
vec3 toYcc(vec3 c) {
  return vec3(dot(c, vec3(0.299, 0.587, 0.114)),
              0.5 - 0.168736 * c.r - 0.331264 * c.g + 0.5 * c.b,
              0.5 + 0.5 * c.r - 0.418688 * c.g - 0.081312 * c.b);
}
vec3 toRgb(vec3 y) {
  return vec3(y.x + 1.402 * (y.z - 0.5), y.x - 0.344136 * (y.y - 0.5) - 0.714136 * (y.z - 0.5), y.x + 1.772 * (y.y - 0.5));
}`;

/** D8: the 8 × 8 box mean of base0 in 16 bilinear taps (each the mean of a 2 × 2 block) */
export const TONE_DOWN8_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uSrcSize;
out vec4 outColor;
void main() {
  vec2 o = floor(gl_FragCoord.xy) * 8.0;
  vec4 s = vec4(0.0);
  for (int b = 0; b < 4; b++)
    for (int a = 0; a < 4; a++) s += texture(uSrc, (o + vec2(float(2 * a + 1), float(2 * b + 1))) / uSrcSize);
  outColor = s / 16.0;
}`;

/** one pass of the separable Gaussian, direct texel taps with CPU-made weights (gaussWeights) */
export const TONE_BLUR_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform ivec2 uDir;
uniform int uR;
uniform float uW[${MAX_BLUR_RADIUS + 1}];
out vec4 outColor;
void main() {
  ivec2 size = textureSize(uSrc, 0);
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 s = uW[0] * texelFetch(uSrc, p, 0);
  for (int k = 1; k <= ${MAX_BLUR_RADIUS}; k++) {
    if (k > uR) break;
    s += uW[k] * (texelFetch(uSrc, clamp(p + uDir * k, ivec2(0), size - 1), 0) + texelFetch(uSrc, clamp(p - uDir * k, ivec2(0), size - 1), 0));
  }
  outColor = s;
}`;

/** L's first stage: the uK × uK box of (Mn8 · q, q), q = Q.G at each Mn8 texel centre */
export const TONE_LBOX_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uMn8;
uniform sampler2D uQ;
uniform int uK;
out vec4 outColor;
void main() {
  ivec2 size = textureSize(uMn8, 0);
  ivec2 o = ivec2(gl_FragCoord.xy) * uK;
  vec4 s = vec4(0.0);
  for (int j = 0; j < 4; j++) {
    if (j >= uK) break;
    for (int i = 0; i < 4; i++) {
      if (i >= uK) break;
      ivec2 t = min(o + ivec2(i, j), size - 1);
      float q = texture(uQ, (vec2(t) + 0.5) / vec2(size)).g;
      s += vec4(texelFetch(uMn8, t, 0).rgb * q, q);
    }
  }
  outColor = s / float(uK * uK);
}`;

/** Δ8 = ZERO + 2·clamp(Δ): 勻膚, 黑眼圈, 法令紋 on the mid band, then 膚色 (S §4.3) */
export const TONE_FIELD_FS = /* glsl */ `#version 300 es
precision highp float;
${COMMON}
uniform sampler2D uMn8;
uniform sampler2D uL;
uniform sampler2D uQ;
uniform sampler2D uR;
out vec4 outColor;
float box(float x, float lo, float hi, float e) { return smoothstep(lo - e, lo, x) * (1.0 - smoothstep(hi, hi + e, x)); }
float skinGate(vec3 c) {
  vec3 y = toYcc(c);
  return box(y.y, ${g(T.skinCb[0])}, ${g(T.skinCb[1])}, ${g(T.skinSoft)}) * box(y.z, ${g(T.skinCr[0])}, ${g(T.skinCr[1])}, ${g(T.skinSoft)});
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 uv = (vec2(p) + 0.5) / vec2(textureSize(uMn8, 0));
  vec3 m = texelFetch(uMn8, p, 0).rgb;
  vec4 L = texture(uL, uv);
  vec3 b = m - L.rgb / max(L.a, 1.0 / 255.0);
  float conf = smoothstep(${g(T.conf[0])}, ${g(T.conf[1])}, L.a);
  float bY = dot(b, L709);
  vec3 bC = b - vec3(bY);
  float lift = -min(bY, 0.0);
  float gE = 1.0 - smoothstep(${g(T.evenGuard[0])}, ${g(T.evenGuard[1])}, abs(bY));
  float gD = 1.0 - smoothstep(${g(T.darkGuard[0])}, ${g(T.darkGuard[1])}, -bY);
  vec4 q = texture(uQ, uv);
  vec4 r = texture(uR, uv);
  vec3 d = q.r * conf * gE * (-${g(T.even.chroma)} * bC + ${g(T.even.lift)} * lift)
         + r.r * conf * gD * (${g(T.darkCircle.lift)} * lift - ${g(T.darkCircle.chroma)} * bC)
         + r.g * conf * gD * (${g(T.nasolabial.lift)} * lift - ${g(T.nasolabial.chroma)} * bC);
  float s = clamp(2.0 * (q.b - ZERO), -1.0, 1.0);
  if (abs(s) > 0.5 / 255.0) {
    vec3 c0 = m + d;
    vec3 k = s >= 0.0 ? ${v3(T.warm)} : ${v3(T.cool)};
    vec3 c1 = c0 * (1.0 + abs(s) * k);
    c1 *= dot(c0, L709) / max(dot(c1, L709), 1e-4);
    d += (c1 - c0) * skinGate(c0);
  }
  outColor = vec4(ZERO + 2.0 * clamp(d, -${g(T.deltaMax)}, ${g(T.deltaMax)}), 1.0);
}`;

/** P0d: c = base0 + Δ8, then 白牙 (R.B) and 亮眼 (R.A); base0 and R cover the buffer, Δ8 and Mn8 the whole O (S §4.4) */
export const RETOUCH_FS = /* glsl */ `#version 300 es
precision highp float;
${COMMON}
in vec2 vUv;
uniform sampler2D uBase;
uniform sampler2D uDelta;
uniform sampler2D uMn8;
uniform sampler2D uR;
uniform vec4 uWin;
uniform float uFieldOn;
out vec4 outColor;
void main() {
  vec2 o = uWin.xy + vUv * uWin.zw;
  vec3 b0 = texture(uBase, vUv).rgb;
  vec3 c = b0;
  if (uFieldOn > 0.5) c += (texture(uDelta, o).rgb - ZERO) * 0.5;
  vec4 r = texture(uR, vUv);
  if (r.b > 0.0) {
    vec3 y = toYcc(c);
    float k = r.b * smoothstep(${g(T.teeth.y[0])}, ${g(T.teeth.y[1])}, y.x) * (1.0 - smoothstep(${g(T.teeth.cr[0])}, ${g(T.teeth.cr[1])}, y.z));
    y.y += max(0.0, 0.5 - y.y) * ${g(T.teeth.cb)} * k;
    y.z += (0.5 - y.z) * ${g(T.teeth.crPull)} * k;
    y.x += ${g(T.teeth.lift)} * k * (1.0 - y.x);
    c = toRgb(y);
  }
  if (r.a > 0.0) {
    vec3 y = toYcc(c);
    float ch = 2.0 * length(y.yz - 0.5);
    float sc = smoothstep(${g(E.scY[0])}, ${g(E.scY[1])}, y.x) * (1.0 - smoothstep(${g(E.scCh[0])}, ${g(E.scCh[1])}, ch));
    y.yz += (0.5 - y.yz) * ${g(E.detint)} * r.a * sc;
    y.x += ${g(E.scLift)} * r.a * sc * (1.0 - y.x);
    float ir = smoothstep(${g(E.irCh[0])}, ${g(E.irCh[1])}, ch) * smoothstep(${g(E.irY0[0])}, ${g(E.irY0[1])}, y.x) * (1.0 - smoothstep(${g(E.irY1[0])}, ${g(E.irY1[1])}, y.x));
    y.x += ${g(E.irLift)} * r.a * ir;
    c = toRgb(y);
    c += ${g(E.clarity)} * r.a * (1.0 - sc) * clamp(b0 - texture(uMn8, o).rgb, -${g(E.clamp)}, ${g(E.clamp)});
  }
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;
```
(Put the `import` line at the top of the file.)

Create `src/engine/passes/toneField.ts`:
```ts
// P0c tone field and P0d retouch (skin-cleanup spec §4.3–4.4). The field is built at working resolution into ⅛-res and
// smaller RGBA8 targets — D8 (8 × 8 box) → T8 → D8 = Mn8 (σ_mid/8), L (box of Mn8·q, q) → Lt → L (σ_low/f_L), Δ8 — and the
// retouch writes base0 + Δ8, then 白牙 and 亮眼, at full resolution (one tile through uWin). Shaders: ../shaders/tone.ts.
import { bindTarget, bindTexture, createProgram, createTexture, deleteTexture, drawFullscreen, FULLSCREEN_VS, type Framebuffer, type GL, type Texture } from '../gl/gl';
import { fieldSizes, gaussWeights, MAX_BLUR_RADIUS, RETOUCH_FS, sigmaMid, TONE_BLUR_FS, TONE_DOWN8_FS, TONE_FIELD_FS, TONE_LBOX_FS } from '../shaders/tone';
import type { Size } from '../uniforms';
import type { Win } from './toneGeometry';

export type FieldFbName = 'D8' | 'T8' | 'L' | 'Lt' | 'Delta8';
export interface ToneFieldTextures {
  mn8: Texture;
  delta8: Texture | null;
}
export interface ToneFieldPass {
  /** D8 → Mn8 from `base0` (`size` = its working size); with `fieldOn` also L → Δ8 from Q and R */
  build(base0: Texture, size: Size, q: Texture, r: Texture, sigmaLowPx: number, fieldOn: boolean, fb: (name: FieldFbName, size: Size) => Framebuffer): ToneFieldTextures;
  dispose(): void;
}
export interface RetouchPass {
  draw(base0: Texture, dst: Framebuffer, delta8: Texture | null, mn8: Texture | null, r: Texture, win: Win, fieldOn: boolean): void;
  dispose(): void;
}

export function createToneFieldPass(gl: GL): ToneFieldPass {
  const down = createProgram(gl, FULLSCREEN_VS, TONE_DOWN8_FS, 'toneDown8');
  const blur = createProgram(gl, FULLSCREEN_VS, TONE_BLUR_FS, 'toneBlur');
  const lbox = createProgram(gl, FULLSCREEN_VS, TONE_LBOX_FS, 'toneLBox');
  const field = createProgram(gl, FULLSCREEN_VS, TONE_FIELD_FS, 'toneField');
  down.use();
  gl.uniform1i(down.u('uSrc'), 0);
  blur.use();
  gl.uniform1i(blur.u('uSrc'), 0);
  lbox.use();
  gl.uniform1i(lbox.u('uMn8'), 0);
  gl.uniform1i(lbox.u('uQ'), 1);
  field.use();
  gl.uniform1i(field.u('uMn8'), 0);
  gl.uniform1i(field.u('uL'), 1);
  gl.uniform1i(field.u('uQ'), 2);
  gl.uniform1i(field.u('uR'), 3);
  const weights = new Float32Array(MAX_BLUR_RADIUS + 1);

  function blurInto(src: Texture, dst: Framebuffer, sigma: number, dx: number, dy: number): void {
    const w = gaussWeights(sigma);
    weights.fill(0);
    weights.set(w);
    blur.use();
    gl.uniform1fv(blur.u('uW'), weights);
    gl.uniform1i(blur.u('uR'), w.length - 1);
    gl.uniform2i(blur.u('uDir'), dx, dy);
    bindTexture(gl, 0, src);
    bindTarget(gl, dst);
    drawFullscreen(gl);
  }

  return {
    build(base0, size, q, r, sigmaLowPx, fieldOn, fb) {
      gl.disable(gl.BLEND);
      const s = fieldSizes(size.width, size.height, sigmaLowPx);
      const d8 = fb('D8', { width: s.d8.w, height: s.d8.h });
      const t8 = fb('T8', { width: s.d8.w, height: s.d8.h });
      down.use();
      gl.uniform2f(down.u('uSrcSize'), size.width, size.height);
      bindTexture(gl, 0, base0);
      bindTarget(gl, d8);
      drawFullscreen(gl);
      const sm = sigmaMid(Math.min(size.width, size.height)) / 8;
      blurInto(d8.tex, t8, sm, 1, 0);
      blurInto(t8.tex, d8, sm, 0, 1);
      if (!fieldOn) {
        bindTexture(gl, 0, null);
        return { mn8: d8.tex, delta8: null };
      }
      const l = fb('L', { width: s.l.w, height: s.l.h });
      const lt = fb('Lt', { width: s.l.w, height: s.l.h });
      lbox.use();
      gl.uniform1i(lbox.u('uK'), s.fL / 8);
      bindTexture(gl, 0, d8.tex);
      bindTexture(gl, 1, q);
      bindTarget(gl, l);
      drawFullscreen(gl);
      const sl = sigmaLowPx / s.fL;
      blurInto(l.tex, lt, sl, 1, 0);
      blurInto(lt.tex, l, sl, 0, 1);
      const dl = fb('Delta8', { width: s.d8.w, height: s.d8.h });
      field.use();
      bindTexture(gl, 0, d8.tex);
      bindTexture(gl, 1, l.tex);
      bindTexture(gl, 2, q);
      bindTexture(gl, 3, r);
      bindTarget(gl, dl);
      drawFullscreen(gl);
      for (let u = 0; u < 4; u++) bindTexture(gl, u, null);
      return { mn8: d8.tex, delta8: dl.tex };
    },
    dispose() {
      down.dispose();
      blur.dispose();
      lbox.dispose();
      field.dispose();
    },
  };
}

export function createRetouchPass(gl: GL): RetouchPass {
  const prog = createProgram(gl, FULLSCREEN_VS, RETOUCH_FS, 'retouch');
  prog.use();
  gl.uniform1i(prog.u('uBase'), 0);
  gl.uniform1i(prog.u('uDelta'), 1);
  gl.uniform1i(prog.u('uMn8'), 2);
  gl.uniform1i(prog.u('uR'), 3);
  // stand-in for a frame without a field (白牙 only): Δ = 0 (uFieldOn 0 skips it anyway) and an unread Mn8
  const zero = createTexture(gl, 1, 1);
  gl.bindTexture(gl.TEXTURE_2D, zero.tex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 128, 255]));
  return {
    draw(base0, dst, delta8, mn8, r, win, fieldOn) {
      gl.disable(gl.BLEND);
      prog.use();
      bindTexture(gl, 0, base0);
      bindTexture(gl, 1, delta8 ?? zero);
      bindTexture(gl, 2, mn8 ?? zero);
      bindTexture(gl, 3, r);
      gl.uniform4f(prog.u('uWin'), win[0], win[1], win[2], win[3]);
      gl.uniform1f(prog.u('uFieldOn'), fieldOn && delta8 ? 1 : 0);
      bindTarget(gl, dst);
      drawFullscreen(gl);
      for (let u = 0; u < 4; u++) bindTexture(gl, u, null);
    },
    dispose() {
      prog.dispose();
      deleteTexture(gl, zero);
    },
  };
}
```
Create `src/engine/toneJob.ts`:
```ts
// Frame inputs of the 膚質 passes (skin-cleanup spec §4.1, §4.3): which of P0b / P0c / P0d run, their region draw lists,
// and the tone-field cache key. Pure.
import type { Face, ParamId, Spot } from '../types';
import { faceFrame, fieldActive, toneActive, toneDrawsQ, toneDrawsR, toneValuesOf, type ToneCap, type ToneDraw } from './passes/toneGeometry';
import { sigmaLow } from './shaders/tone';
import type { Size } from './uniforms';

export interface ToneJobFace {
  face: Face;
  weight: number;
  values: Readonly<Partial<Record<ParamId, number>>>;
  cap: ToneCap | null;
}
export interface ToneJob {
  /** P0b runs when non-empty */
  spots: readonly Spot[];
  drawsR: readonly ToneDraw[];
  drawsQ: readonly ToneDraw[];
  /** 勻膚, 膚色, 黑眼圈 or 法令紋 on some face: L and Δ8 are built */
  fieldOn: boolean;
  /** the field runs at all (fieldOn, or 亮眼, which needs Mn8 only) */
  mn8On: boolean;
  /** P0d runs (any tone item on) */
  retouchOn: boolean;
  /** the field's identity: working image, size, spots, every face's field inputs, σ_low */
  key: string;
  /** working-resolution size the field is built at (the preview source, or RenderInput.toneSource) */
  work: Size;
  sigmaLowPx: number;
}

const ids = new WeakMap<object, number>();
let nextId = 1;
/** a stable number per object: the engine re-uploads `source` every frame, so the key uses the object (S §4.3) */
export function objectId(o: object): number {
  let id = ids.get(o);
  if (id === undefined) {
    id = nextId++;
    ids.set(o, id);
  }
  return id;
}

export function spotsKey(spots: readonly Spot[]): string {
  return spots.map((s) => `${s.x},${s.y},${s.r},${s.dx},${s.dy}`).join(';');
}

/** null when nothing of step 4 runs: the frame is then exactly step 3's */
export function buildToneJob(i: { faces: readonly ToneJobFace[]; spots: readonly Spot[]; aspect: number; work: Size; sourceId: number }): ToneJob | null {
  const faces = i.faces.map((f) => ({ ...f, tone: toneValuesOf(f.values) }));
  const live = faces.filter((f) => f.weight > 0);
  const active = live.filter((f) => toneActive(f.tone));
  if (!i.spots.length && !active.length) return null;
  const fieldOn = active.some((f) => fieldActive(f.tone));
  const mn8On = fieldOn || active.some((f) => f.tone.eyeBright > 0);
  const retouchOn = active.length > 0;
  const fwPx = (face: Face) => faceFrame(face, i.aspect).fw * i.work.width;
  const fwMax = Math.max(0, ...active.filter((f) => fieldActive(f.tone)).map((f) => fwPx(f.face)));
  const sigmaLowPx = fieldOn ? sigmaLow(fwMax, Math.min(i.work.width, i.work.height)) : 0;
  const inputs = live.map((f) => ({ face: f.face, values: f.tone, weight: f.weight, cap: f.cap }));
  const facesKey = faces
    .map((f, k) => [k, f.weight, fwPx(f.face).toFixed(3), f.tone.even, f.tone.warmth, f.tone.darkCircle, f.tone.nasolabial, f.tone.eyeBright > 0 ? 1 : 0].join(':'))
    .join('|');
  return {
    spots: i.spots,
    drawsR: retouchOn ? toneDrawsR(inputs, i.aspect) : [],
    drawsQ: fieldOn ? toneDrawsQ(inputs, i.aspect) : [],
    fieldOn,
    mn8On,
    retouchOn,
    key: `${i.sourceId}@${i.work.width}x${i.work.height}#${spotsKey(i.spots)}#${facesKey}#${sigmaLowPx.toFixed(4)}`,
    work: i.work,
    sigmaLowPx,
  };
}
```
`src/types.ts` — in step 1's `RenderInput`, add (C §4.1):
```ts
  /** step 4: the working-resolution image the tone field is built from when `source` is only a tile window */
  toneSource?: { source: TexImageSource; width: number; height: number };
```
(after step 3's `oAspect`, the last field, `types.ts:497-498`), and in `RenderStats` (`types.ts:512-519`):
```ts
  /** the tone field (P0c) was rebuilt by this frame */
  toneBuilt?: boolean;
```
`src/engine/pipeline.ts`:
- imports: `import { createRetouchPass, createToneFieldPass, type FieldFbName, type RetouchPass, type ToneFieldPass, type ToneFieldTextures } from './passes/toneField';`, `import { createToneMaskPass, type ToneMaskPass } from './passes/toneMask';`, `import { IDENTITY_WIN, Q_CLEAR, R_CLEAR } from './passes/toneGeometry';`, `import type { ToneJob } from './toneJob';`
- `FrameJob` gains `/** step 4: the 膚質 passes of this frame, null = none (toneJob.ts) */ tone: ToneJob | null;`
- `FrameResult` gains `/** the tone field was rebuilt by this frame */ toneBuilt: boolean;`
- `type FbName = 'A' | 'B' | 'C' | 'D' | 'M' | 'N' | 'R' | 'Q' | FieldFbName;`
- state next to the other passes (after `let overlay`):
  ```ts
  let toneMask: ToneMaskPass | null = null;
  let toneField: ToneFieldPass | null = null;
  let retouch: RetouchPass | null = null;
  /** the key of the field the D8 / Delta8 targets hold (S §4.3 cache), and its textures */
  let toneKey: string | null = null;
  let toneTex: ToneFieldTextures | null = null;
  let toneWarned = false;

  /** P0c at working resolution from `base0`, with R already drawn into `rTex`; Q is drawn here */
  function buildToneField(tj: ToneJob, base0: Texture, rTex: Texture): ToneFieldTextures {
    toneMask ??= createToneMaskPass(gl);
    toneField ??= createToneFieldPass(gl);
    const q = fb('Q', maskBufferSize(tj.work));
    toneMask.draw(q, tj.drawsQ, IDENTITY_WIN, Q_CLEAR);
    toneTex = toneField.build(base0, tj.work, q.tex, rTex, tj.sigmaLowPx, tj.fieldOn, (name, size) => fb(name, size));
    toneKey = tj.key;
    return toneTex;
  }
  ```
- in `run()`, right before the makeup block — after the P0 mask block and step 3's declarations `let base: Texture = job.src;` / `let baseFb: Framebuffer | null = null;` (`pipeline.ts:456-457`), before `if (plan.makeup && makeup)` — and declare `let toneBuilt = false;` at the top of `run()`:
  ```ts
      // ── step 4: P0c tone field (cached) and P0d retouch, in O before P1 (skin-cleanup spec §4.1) ──
      const tj = job.tone;
      if (tj && tj.retouchOn) {
        const windowed = job.win[0] !== 0 || job.win[1] !== 0 || job.win[2] !== 1 || job.win[3] !== 1;
        toneMask ??= createToneMaskPass(gl);
        const r = fb('R', maskBufferSize(job.srcSize));
        toneMask.draw(r, tj.drawsR, job.win, R_CLEAR);
        let field: ToneFieldTextures | null = null;
        if (tj.mn8On) {
          if (toneKey === tj.key && toneTex) field = toneTex;
          else if (!windowed) {
            field = buildToneField(tj, base, r.tex);
            toneBuilt = true;
          } else if (!toneWarned) {
            toneWarned = true;
            console.warn('[engine] a tile asked for a tone field that was not prepared; drawing it without the field');
          }
          if (field) passes.push('toneField');
        }
        retouch ??= createRetouchPass(gl);
        const b = full('B', baseFb, job.srcSize);
        retouch.draw(base, b, field?.delta8 ?? null, field?.mn8 ?? null, r.tex, job.win, tj.fieldOn && !!field?.delta8);
        base = b.tex;
        baseFb = b;
        passes.push('retouch');
      }
  ```
  (`base` / `baseFb` are step 3's variables at `pipeline.ts:456-457`; the block needs no move.)
- `run()` returns `{ passes, output, toneBuilt }` (today `return { passes, output };`, `pipeline.ts:538`).
- `dispose()`: in the `!lost` branch add `toneMask?.dispose(); toneField?.dispose(); retouch?.dispose();`, and in the reset part `toneMask = toneField = retouch = null; toneKey = null; toneTex = null;` — so a restored context rebuilds the field (Review Focus 1).
- step 3's `releaseBuffers` must leave the field targets alone (S §4.3: they are freed only on dispose or context loss). It loops over every entry of `fbs` (`for (const f of Object.values(fbs)) if (f) resizeFramebuffer(gl, f, 1, 1);`, `pipeline.ts:564`), so restrict that loop to `for (const k of ['A', 'B', 'C', 'D', 'M', 'N'] as const) { const f = fbs[k]; if (f) resizeFramebuffer(gl, f, 1, 1); }`.

`src/engine/index.ts`, in `job()` — step 1 builds `const listed = input.faces.slice(0, MAX_RENDER_FACES);` and `const faces: FrameFace[] = listed.map(…)` with `centre: boxCentre(ovalBox(f.face))` and `presence: f.presence ?? 1`, and returns `obstacles: input.obstacles ?? []` (step-1 plan Task 18); step 3 computes `const view = viewFields(input, size);` first and spreads it into the result, so the O aspect is `view.oAspect` (step-3 plan Task 8). Before the `return`, add
```ts
    // the same caps step 1's tableFaces() gives the face table (texel 73), for every listed face, warps or not
    const toneCaps = capsFor(faces.map((f) => f.centre), input.obstacles ?? [], view.oAspect, faces.map((f) => f.presence));
```
and add to the returned `FrameJob`:
```ts
      tone: buildToneJob({
        faces: faces.map((f, i) => ({ face: f.face, weight: f.weight, values: listed[i].person.values, cap: toneCapOf(f.centre, toneCaps[i]) })),
        spots: input.photo.spots,
        aspect: view.oAspect,
        work: { width: (input.toneSource ?? input).width, height: (input.toneSource ?? input).height },
        sourceId: objectId((input.toneSource?.source ?? input.source) as object),
      }),
```
with, above `createEngine`:
```ts
/** a face's cap (capsFor: iso radius, −1 = none) around its oval-box centre (UV) as toneGeometry's ToneCap */
function toneCapOf(centre: readonly [number, number], cap: number): ToneCap | null {
  return cap >= 0 ? { c: [centre[0], centre[1]], r: cap } : null;
}
```
(Imports: add `capsFor` to step 1's `import { boxCentre, ovalBox } from './passes/faceCap';` (`index.ts:20`); `buildToneJob`, `objectId` from `./toneJob`; `type ToneCap` from `./passes/toneGeometry`. `job()` holds step 3's view fields as `view` (`index.ts:301`); `oAspect` is the working bitmap's aspect that the pipeline also hands to `tableFaces`.) In `render()`, return `toneBuilt: res.toneBuilt` alongside `passes` (`index.ts:396`).

`src/app/still.ts` — in `flush()` (`still.ts:188-207`) the display render is `engine.render({ ...input(frame), geometry: viewGeometry(frame) }, { still: true })` (`compare` draws `renderOriginal` instead) and step 3 already publishes `renderCount` through `const d = debugState();`. Keep the render's stats and publish them there:
```ts
      let st: RenderStats | null = null;
      if (compare) engine.renderOriginal({ source: bitmap, width, height, geometry: viewGeometry(frame) }, { still: true });
      else st = engine.render({ ...input(frame), geometry: viewGeometry(frame) }, { still: true });
      drawn = frame;
      const d = debugState();
      if (d) {
        d.renderCount = (d.renderCount ?? 0) + 1;
        if (st) {
          d.passes = st.passes;
          if (st.toneBuilt) d.toneBuilds += 1;
        }
      }
```
(add `RenderStats` to the file's `../types` type import, `still.ts:10`.)

- [ ] **Step 4: Pin the shader hash and run the unit tests**

Run: `npx vitest run src/engine/toneCpu.test.ts -t "tone shaders pin"`
Expected: FAIL — `expected '<8 hex digits>' to be '00000000'`. Copy the received hash into the test in place of `'00000000'`.
Run: `npx vitest run src/engine && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Run the engine harness and the existing engine specs**

Run: `npm run build && npx playwright test tests/e2e/tone-engine.spec.ts tests/e2e/engine.spec.ts tests/e2e/parity.spec.ts`
Expected: all pass. The log shows the six crops at both levels within max 2 and mean 0.25, every tool's checks, and `built [true, false, false, true]`.

- [ ] **Step 6: Commit**

```bash
git add src/engine/shaders/tone.ts src/engine/passes/toneField.ts src/engine/toneJob.ts src/engine/toneJob.test.ts src/engine/toneCpu.test.ts src/engine/pipeline.ts src/engine/index.ts src/types.ts src/app/still.ts tests/e2e/pages/tone.ts tests/e2e/tone-engine.spec.ts
git commit -m "v0.4 step 4 (11/20): tone field P0c and retouch P0d on the GPU, cached field" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: The heal shaders and their CPU reference (`healCpu.ts`)

**Files:**
- Create: `src/engine/shaders/heal.ts`, `src/engine/healCpu.ts`, `src/engine/healCpu.test.ts`

**Interfaces:**
- Consumes: `HEAL_RING_SAMPLES` (Task 1), `TONE_ZERO`, `IDENTITY_WIN`, `Win`, `smoothstep` (Task 5), `glf` (Task 8), `Img`, `sample`, `q8`, `LUMA709`, `makeImg` (Task 8), `shaderHash` (step 2).
- Produces:
  ```ts
  // src/engine/shaders/heal.ts
  export const HEAL_RING_VS: string; export const HEAL_RING_FS: string; export const HEAL_VS: string; export const HEAL_FS: string;
  // src/engine/healCpu.ts
  export interface SpotPx { c: [number, number]; r: number; d: [number, number]; fill: boolean }
  export function spotPx(s: Spot, w: number, h: number, win?: Win): SpotPx;
  export function robustWeights(y: ArrayLike<number>): Float64Array;           // o_k, S §4.5 step 2
  export function ringRow(src: Img, s: SpotPx, n?: number): { enc: Float64Array; w: Float64Array };  // what RING stores, 8-bit
  export function membrane(rp: number, phi: number, enc: ArrayLike<number>, w: ArrayLike<number>, fill: boolean, n?: number): [number, number, number];
  export function healCpu(src: Img, spots: readonly Spot[], win?: Win, n?: number): Img;
  ```
  The heal (S §4.5): copy src → A; RING fragment (k, s) holds `ZERO + Δ_k` (fill: `T_k`) and the robust weight o_k; each spot quad (half-side 1.1 r) blends `healed·α, α` with `ONE, ONE_MINUS_SRC_ALPHA`, healed = `src(p + d) + M` (fill: `M`), M the Poisson-kernel mean of the ring at radius 1.3 r. Robust weights: μ₀ = mean Y(Δ), σ₀ = rms(Y(Δ) − μ₀) + 0.01, o = 1/(1 + ((Y − μ)/2σ)²); then μ₁ and σ₁ (the o-weighted mean and rms, + 0.01) and o once more with them.

- [ ] **Step 1: Write the failing tests**

Create `src/engine/healCpu.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { HEAL_RING_SAMPLES } from '../config/limits';
import type { Spot } from '../types';
import { healCpu, membrane, robustWeights } from './healCpu';
import { TONE_ZERO } from './passes/toneGeometry';
import { shaderHash } from './shaderHash';
import { HEAL_FS, HEAL_RING_FS } from './shaders/heal';
import { makeImg, q8, type Img } from './toneCpu';

const N = HEAL_RING_SAMPLES;
const ones = () => new Float64Array(N).fill(1);
/** encoded ring values (non-fill): ZERO + Δ_k, all channels f(θ_k) */
const ring = (f: (th: number) => number) => {
  const e = new Float64Array(N * 3);
  for (let k = 0; k < N; k++) e.fill(TONE_ZERO + f((2 * Math.PI * k) / N), k * 3, k * 3 + 3);
  return e;
};
const hash = (x: number, y: number) => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s) - 0.5;
};
function field(w: number, h: number, f: (x: number, y: number) => number): Img {
  const o = makeImg(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) o.d.set([q8(f(x, y)), q8(f(x, y) * 0.8), q8(f(x, y) * 0.7), 1], (y * w + x) * 4);
  return o;
}
const Y = (a: Img, x: number, y: number) => 0.2126 * a.d[(y * a.w + x) * 4] + 0.7152 * a.d[(y * a.w + x) * 4 + 1] + 0.0722 * a.d[(y * a.w + x) * 4 + 2];
function stats(a: Img, cx: number, cy: number, r0: number, r1: number) {
  let s = 0;
  let s2 = 0;
  let n = 0;
  for (let y = Math.floor(cy - r1); y <= Math.ceil(cy + r1); y++)
    for (let x = Math.floor(cx - r1); x <= Math.ceil(cx + r1); x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d < r0 || d > r1) continue;
      const v = Y(a, x, y);
      s += v;
      s2 += v * v;
      n++;
    }
  return { mean: s / n, sd: Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2)) };
}

describe('the Poisson membrane (skin-cleanup spec §4.5)', () => {
  it('a constant ring gives a constant disc exactly', () => {
    for (const [rp, phi] of [[0, 0], [0.3, 1], [0.84, -2.5]]) for (const v of membrane(rp, phi, ring(() => 0.1), ones(), false)) expect(v).toBeCloseTo(0.1, 9);
  });

  it('a linear ring gives a linear disc within 1e-3', () => {
    for (const [rp, phi] of [[0.2, 0.4], [0.5, 2], [0.77, -1.1]]) {
      const m = membrane(rp, phi, ring((th) => 0.2 * Math.cos(th) + 0.05), ones(), false);
      expect(Math.abs(m[0] - (0.2 * rp * Math.cos(phi) + 0.05))).toBeLessThan(1e-3);
    }
  });

  it('matches the ring at ρ′ → 1 (donor + membrane meets the surroundings without a seam)', () => {
    const th = (2 * Math.PI * 3) / N;
    const m = membrane(0.999, th, ring((t) => 0.2 * Math.sin(3 * t)), ones(), false);
    expect(Math.abs(m[0] - 0.2 * Math.sin(3 * th))).toBeLessThan(0.01);
  });

  it('robust weights shrink an outlier', () => {
    const y = new Float64Array(N).fill(0.01);
    y[5] = 0.3;
    const o = robustWeights(y);
    expect(o[5]).toBeLessThan(0.05);
    expect(o[0]).toBeGreaterThan(0.9);
  });
});

describe('healCpu', () => {
  const S = 128;
  const spot = (x: number, y: number, r: number, dx: number, dy = 0): Spot => ({ x: x / S, y: y / S, r: r / S, dx: dx / S, dy: dy / S, owner: null });
  const skin = (x: number, y: number) => 0.7 + 0.03 * hash(x, y);

  it('a dark dot on textured skin: the disc keeps the skin’s texture (sd within 15 %) and tone (mean within 1 %)', () => {
    const dot = (x: number, y: number) => skin(x, y) * (1 - 0.25 * Math.exp(-((x - 64) ** 2 + (y - 64) ** 2) / 18));
    const out = healCpu(field(S, S, dot), [spot(64.5, 64.5, 8, 26)]);
    const disc = stats(out, 64.5, 64.5, 0, 3.6);
    const around = stats(out, 64.5, 64.5, 12, 16);
    expect(Math.abs(disc.sd - around.sd) / around.sd).toBeLessThan(0.15);
    expect(Math.abs(disc.mean - around.mean) / around.mean).toBeLessThan(0.01);
  });

  it('fill mode (no donor) interpolates the surroundings smoothly', () => {
    const ramp = (x: number) => 0.4 + x / 400;
    const img = field(S, S, (x, y) => ramp(x) - 0.2 * Math.exp(-((x - 64) ** 2 + (y - 64) ** 2) / 18));
    const out = healCpu(img, [spot(64.5, 64.5, 8, 0)]);
    for (const [x, y] of [[64, 64], [61, 66], [67, 62]]) expect(Math.abs(out.d[(y * S + x) * 4] - q8(ramp(x))) * 255).toBeLessThanOrEqual(2);
  });

  it('a 2 px dark line crossing only the spot’s ring adds < 2/255 on average inside the disc (robust weights)', () => {
    const flat = (x: number, y: number) => 0.6 - 0.2 * Math.exp(-((x - 64) ** 2 + (y - 64) ** 2) / 18);
    const lined = (x: number, y: number) => (x === 74 || x === 75 ? 0.3 : flat(x, y)); // at ρ 1.2–1.3: outside the quad
    const a = healCpu(field(S, S, flat), [spot(64.5, 64.5, 8, 30)]);
    const b = healCpu(field(S, S, lined), [spot(64.5, 64.5, 8, 30)]);
    let sum = 0;
    let n = 0;
    for (let y = 56; y <= 73; y++)
      for (let x = 56; x <= 73; x++) {
        if (Math.hypot(x + 0.5 - 64.5, y + 0.5 - 64.5) > 0.8 * 8) continue;
        sum += Math.abs(a.d[(y * S + x) * 4] - b.d[(y * S + x) * 4]) * 255;
        n++;
      }
    expect(sum / n).toBeLessThan(2);
  });

  it('two overlapping spots compose: far from the second, the first is healed as alone', () => {
    const img = field(S, S, skin);
    const one = healCpu(img, [spot(50.5, 64.5, 8, 0, 26)]);
    const two = healCpu(img, [spot(50.5, 64.5, 8, 0, 26), spot(57, 64.5, 8, 0, -26)]);
    for (const [x, y] of [[44, 64], [45, 60], [46, 69]]) {
      if (Math.hypot(x + 0.5 - 57, y + 0.5 - 64.5) <= 8.8) continue;
      expect(Math.abs(one.d[(y * S + x) * 4] - two.d[(y * S + x) * 4]) * 255).toBeLessThanOrEqual(1);
    }
    for (const v of two.d) expect(Number.isFinite(v)).toBe(true);
  });

  it('is pinned to the heal shaders: a change must be mirrored here (then update this hash)', () => {
    expect(shaderHash([HEAL_RING_FS, HEAL_FS].join('\n'))).toBe('00000000');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/engine/healCpu.test.ts`
Expected: FAIL — `Failed to resolve import "./healCpu"`.

- [ ] **Step 3: Implement**

Create `src/engine/shaders/heal.ts`:
```ts
// 祛痘 heal shaders (skin-cleanup spec §4.5): the robust ring pass and the Poisson-membrane spot quads. Original work;
// mirrored by src/engine/healCpu.ts (hash-pinned in healCpu.test.ts). Spots arrive per instance in O units (centre
// normalized, radius and donor as fractions of the O short edge) and are mapped into the src through uWin / uSrcPx.
import { HEAL_RING_SAMPLES } from '../../config/limits';
import { TONE_ZERO } from '../passes/toneGeometry';
import { glf } from './tone';

const COMMON = /* glsl */ `
const int N = ${HEAL_RING_SAMPLES};
const float ZERO = ${glf(TONE_ZERO)};
const vec3 L709 = vec3(0.2126, 0.7152, 0.0722);
const float TAU = 6.283185307179586;`;

/** one instanced quad per spot covering row gl_InstanceID of the RING target (N × spots) */
export const HEAL_RING_VS = /* glsl */ `#version 300 es
in vec2 aCorner;
in vec4 aSpot;   // x, y (O uv), r (short-edge fraction), fill (1 = no donor)
in vec2 aDonor;  // dx, dy (short-edge fractions)
uniform float uRows;
flat out vec4 vSpot;
flat out vec2 vDonor;
void main() {
  vSpot = aSpot;
  vDonor = aDonor;
  vec2 p = vec2(aCorner.x, (float(gl_InstanceID) + aCorner.y) / uRows);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** RING (k, s): ZERO + Δ_k (fill: T_k) and the robust weight o_k of spot s */
export const HEAL_RING_FS = /* glsl */ `#version 300 es
precision highp float;
${COMMON}
flat in vec4 vSpot;
flat in vec2 vDonor;
uniform sampler2D uSrc;
uniform vec4 uWin;
uniform vec2 uSrcPx;
out vec4 outColor;
vec3 tap(vec2 px) { return texture(uSrc, px / uSrcPx).rgb; }
vec3 ringMean(vec2 c, vec2 u, float r) { return (tap(c + 1.2 * r * u) + tap(c + 1.3 * r * u) + tap(c + 1.4 * r * u)) / 3.0; }
void main() {
  vec2 oPx = uSrcPx / uWin.zw;
  float s = min(oPx.x, oPx.y);
  vec2 c = (vSpot.xy - uWin.xy) * oPx;
  float r = vSpot.z * s;
  vec2 d = vDonor * s;
  bool fill = vSpot.w > 0.5;
  vec3 dl[N];
  float y[N];
  float mu = 0.0;
  for (int k = 0; k < N; k++) {
    float th = TAU * float(k) / float(N);
    vec2 u = vec2(cos(th), sin(th));
    vec3 T = ringMean(c, u, r);
    dl[k] = fill ? T : T - ringMean(c + d, u, r);
    y[k] = dot(dl[k], L709);
    mu += y[k];
  }
  mu /= float(N);
  float v = 0.0;
  for (int k = 0; k < N; k++) v += (y[k] - mu) * (y[k] - mu);
  float sig = sqrt(v / float(N)) + 0.01;
  float sw = 0.0;
  float swy = 0.0;
  for (int k = 0; k < N; k++) {
    float e = (y[k] - mu) / (2.0 * sig);
    float o = 1.0 / (1.0 + e * e);
    sw += o;
    swy += o * y[k];
  }
  float mu1 = swy / sw;
  float sv = 0.0;
  for (int k = 0; k < N; k++) {
    float e = (y[k] - mu) / (2.0 * sig);
    sv += (y[k] - mu1) * (y[k] - mu1) / (1.0 + e * e);
  }
  float sig1 = sqrt(sv / sw) + 0.01;
  int k0 = int(gl_FragCoord.x);
  float e1 = (y[k0] - mu1) / (2.0 * sig1);
  outColor = vec4(fill ? dl[k0] : vec3(ZERO) + dl[k0], 1.0 / (1.0 + e1 * e1));
}`;

/** one instanced quad per spot, half-side 1.1 r, in src px */
export const HEAL_VS = /* glsl */ `#version 300 es
in vec2 aCorner;
in vec4 aSpot;
in vec2 aDonor;
uniform vec4 uWin;
uniform vec2 uSrcPx;
flat out vec4 vSpot;   // centre (px), r (px), fill
flat out vec2 vDonor;  // px
flat out int vRow;
void main() {
  vec2 oPx = uSrcPx / uWin.zw;
  float s = min(oPx.x, oPx.y);
  vec2 c = (aSpot.xy - uWin.xy) * oPx;
  float r = aSpot.z * s;
  vSpot = vec4(c, r, aSpot.w);
  vDonor = aDonor * s;
  vRow = gl_InstanceID;
  vec2 p = c + (aCorner * 2.0 - 1.0) * 1.1 * r;
  gl_Position = vec4(p / uSrcPx * 2.0 - 1.0, 0.0, 1.0);
}`;

/** donor + harmonic membrane (the healing brush), feathered over ρ 0.8 … 1.1; premultiplied output */
export const HEAL_FS = /* glsl */ `#version 300 es
precision highp float;
${COMMON}
flat in vec4 vSpot;
flat in vec2 vDonor;
flat in int vRow;
uniform sampler2D uSrc;
uniform sampler2D uRing;
uniform vec2 uSrcPx;
out vec4 outColor;
void main() {
  vec2 p = gl_FragCoord.xy;
  vec2 dp = p - vSpot.xy;
  float rr = length(dp);
  float rho = rr / vSpot.z;
  if (rho > 1.1) discard;
  float rp = rr / (1.3 * vSpot.z);
  float phi = rr > 1e-6 ? atan(dp.y, dp.x) : 0.0;
  bool fill = vSpot.w > 0.5;
  vec3 num = vec3(0.0);
  float den = 0.0;
  for (int k = 0; k < N; k++) {
    vec4 ring = texelFetch(uRing, ivec2(k, vRow), 0);
    float P = (1.0 - rp * rp) / (1.0 - 2.0 * rp * cos(phi - TAU * float(k) / float(N)) + rp * rp);
    float w = ring.a * P;
    num += w * (fill ? ring.rgb : ring.rgb - vec3(ZERO));
    den += w;
  }
  vec3 M = num / max(den, 1e-6);
  vec3 healed = fill ? M : texture(uSrc, (p + vDonor) / uSrcPx).rgb + M;
  float a = 1.0 - smoothstep(0.8, 1.1, rho);
  outColor = vec4(clamp(healed, 0.0, 1.0) * a, a);
}`;
```
Create `src/engine/healCpu.ts`:
```ts
// CPU reference of the 祛痘 heal P0b (skin-cleanup spec §4.5): the copy, the robust ring (8-bit, as the RING target
// stores it) and the Poisson-membrane spot quads with premultiplied blending into the 8-bit copy, in list order. Mirrors
// ./shaders/heal.ts (hash-pinned in healCpu.test.ts); tests/e2e/tone-engine.spec.ts compares the GPU with it.
import { HEAL_RING_SAMPLES } from '../config/limits';
import type { Spot } from '../types';
import { IDENTITY_WIN, smoothstep, TONE_ZERO, type Win } from './passes/toneGeometry';
import { LUMA709, q8, sample, type Img } from './toneCpu';

export interface SpotPx {
  c: [number, number];
  r: number;
  d: [number, number];
  fill: boolean;
}

/** a spot in the px of a src covering the O rectangle `win` */
export function spotPx(s: Spot, w: number, h: number, win: Win = IDENTITY_WIN): SpotPx {
  const ox = w / win[2];
  const oy = h / win[3];
  const short = Math.min(ox, oy);
  return { c: [(s.x - win[0]) * ox, (s.y - win[1]) * oy], r: s.r * short, d: [s.dx * short, s.dy * short], fill: s.dx === 0 && s.dy === 0 };
}

/** o_k: μ₀ and σ₀ from all samples; μ₁ and σ₁ weighted by those first weights; then the weights once more */
export function robustWeights(y: ArrayLike<number>): Float64Array {
  const n = y.length;
  let mu = 0;
  for (let k = 0; k < n; k++) mu += y[k];
  mu /= n;
  let v = 0;
  for (let k = 0; k < n; k++) v += (y[k] - mu) ** 2;
  const sig = Math.sqrt(v / n) + 0.01;
  const o0 = new Float64Array(n);
  let sw = 0;
  let swy = 0;
  for (let k = 0; k < n; k++) {
    o0[k] = 1 / (1 + ((y[k] - mu) / (2 * sig)) ** 2);
    sw += o0[k];
    swy += o0[k] * y[k];
  }
  const mu1 = swy / sw;
  let sv = 0;
  for (let k = 0; k < n; k++) sv += o0[k] * (y[k] - mu1) ** 2;
  const sig1 = Math.sqrt(sv / sw) + 0.01;
  const out = new Float64Array(n);
  for (let k = 0; k < n; k++) out[k] = 1 / (1 + ((y[k] - mu1) / (2 * sig1)) ** 2);
  return out;
}

const tmp = [0, 0, 0, 0];
function tap(src: Img, x: number, y: number, out: number[]): number[] {
  sample(src, x / src.w, y / src.h, tmp);
  out[0] = tmp[0];
  out[1] = tmp[1];
  out[2] = tmp[2];
  return out;
}
function ringMean(src: Img, c: readonly [number, number], ux: number, uy: number, r: number): [number, number, number] {
  const a = [0, 0, 0];
  const s: [number, number, number] = [0, 0, 0];
  for (const k of [1.2, 1.3, 1.4]) {
    tap(src, c[0] + k * r * ux, c[1] + k * r * uy, a);
    s[0] += a[0] / 3;
    s[1] += a[1] / 3;
    s[2] += a[2] / 3;
  }
  return s;
}

/** what the RING target stores for one spot: encoded values (ZERO + Δ_k, fill: T_k) and the weights, both 8-bit */
export function ringRow(src: Img, s: SpotPx, n = HEAL_RING_SAMPLES): { enc: Float64Array; w: Float64Array } {
  const dl = new Float64Array(n * 3);
  const y = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const th = (2 * Math.PI * k) / n;
    const ux = Math.cos(th);
    const uy = Math.sin(th);
    const T = ringMean(src, s.c, ux, uy, s.r);
    const D = s.fill ? [0, 0, 0] : ringMean(src, [s.c[0] + s.d[0], s.c[1] + s.d[1]], ux, uy, s.r);
    for (let c = 0; c < 3; c++) dl[k * 3 + c] = T[c] - D[c];
    y[k] = LUMA709[0] * dl[k * 3] + LUMA709[1] * dl[k * 3 + 1] + LUMA709[2] * dl[k * 3 + 2];
  }
  const o = robustWeights(y);
  const enc = new Float64Array(n * 3);
  const w = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    for (let c = 0; c < 3; c++) enc[k * 3 + c] = q8((s.fill ? 0 : TONE_ZERO) + dl[k * 3 + c]);
    w[k] = q8(o[k]);
  }
  return { enc, w };
}

/** M at (ρ′, φ): Σ o_k P_k Δ_k / Σ o_k P_k with the Poisson kernel P_k = (1 − ρ′²)/(1 − 2ρ′cos(φ − θ_k) + ρ′²) */
export function membrane(rp: number, phi: number, enc: ArrayLike<number>, w: ArrayLike<number>, fill: boolean, n = HEAL_RING_SAMPLES): [number, number, number] {
  const num: [number, number, number] = [0, 0, 0];
  let den = 0;
  const z = fill ? 0 : TONE_ZERO;
  for (let k = 0; k < n; k++) {
    const P = (1 - rp * rp) / (1 - 2 * rp * Math.cos(phi - (2 * Math.PI * k) / n) + rp * rp);
    const wk = w[k] * P;
    for (let c = 0; c < 3; c++) num[c] += wk * (enc[k * 3 + c] - z);
    den += wk;
  }
  const dd = Math.max(den, 1e-6);
  return [num[0] / dd, num[1] / dd, num[2] / dd];
}

/** P0b: the copy of `src` with every spot healed in list order (each quad reads the unhealed src) */
export function healCpu(src: Img, spots: readonly Spot[], win: Win = IDENTITY_WIN, n = HEAL_RING_SAMPLES): Img {
  const out: Img = { w: src.w, h: src.h, d: src.d.slice() };
  const donor = [0, 0, 0];
  for (const sp of spots) {
    const s = spotPx(sp, src.w, src.h, win);
    const { enc, w } = ringRow(src, s, n);
    const x0 = Math.max(0, Math.floor(s.c[0] - 1.1 * s.r));
    const x1 = Math.min(src.w - 1, Math.ceil(s.c[0] + 1.1 * s.r));
    const y0 = Math.max(0, Math.floor(s.c[1] - 1.1 * s.r));
    const y1 = Math.min(src.h - 1, Math.ceil(s.c[1] + 1.1 * s.r));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - s.c[0];
        const dy = y + 0.5 - s.c[1];
        const rr = Math.hypot(dx, dy);
        const rho = rr / s.r;
        if (rho > 1.1) continue;
        const M = membrane(rr / (1.3 * s.r), rr > 1e-6 ? Math.atan2(dy, dx) : 0, enc, w, s.fill, n);
        if (!s.fill) tap(src, x + 0.5 + s.d[0], y + 0.5 + s.d[1], donor);
        const a = 1 - smoothstep(0.8, 1.1, rho);
        const i = (y * src.w + x) * 4;
        for (let c = 0; c < 3; c++) {
          const healed = Math.min(1, Math.max(0, (s.fill ? 0 : donor[c]) + M[c]));
          out.d[i + c] = q8(healed * a + out.d[i + c] * (1 - a));
        }
      }
  }
  return out;
}
```

- [ ] **Step 4: Pin the hash and run the tests**

Run: `npx vitest run src/engine/healCpu.test.ts`
Expected: only the pin test fails, printing the received hash; copy it in place of `'00000000'`.
Run: `npx vitest run src/engine/healCpu.test.ts && npm run typecheck`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/shaders/heal.ts src/engine/healCpu.ts src/engine/healCpu.test.ts
git commit -m "v0.4 step 4 (12/20): heal shaders and their CPU reference" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Spot planning — radius, regions, owner, snap and donor; the patch reader

**Files:**
- Modify: `src/edit/spots.ts` (append the planning half)
- Create: `src/edit/patch.ts`
- Modify: `src/media/exporter.ts` (step 3's `SurfaceOptions` gains `willReadFrequently`)
- Test: `src/edit/spots.test.ts`, `src/edit/patch.test.ts`

**Interfaces:**
- Consumes: `Spot`, `SpotSize`, `SPOT_CAP` (Task 1); `Face`, `PersonMask`, `Rect`, `PersonId`, step 1 `DetectionCache` (`persons: PersonInfoCached[]` with `face`/`body` links, `bodies: CachedBody[] | null`); step 3's `createSurface(width, height, opts: SurfaceOptions = {}): Surface` with `SurfaceOptions { type?: 'image/jpeg' | 'image/png'; alpha?: boolean }` (step-3 plan Task 5, crop spec §3.8).
- Produces (`src/edit/spots.ts`, appended):
  ```ts
  export type V2 = [number, number];
  export const SPOT_K: Record<SpotSize, number>;                     // S 0.018 · M 0.030 · L 0.048
  export interface SpotFace { id: string; face: Face }               // cached face id, O-space adapted face
  export type RegionKind = 'eye' | 'mouth' | 'lip' | 'skin' | 'other';
  export interface Region { kind: RegionKind; face?: string }
  export function regionAt(o: V2, faces: readonly SpotFace[], aspect: number): Region;
  export function spotRadius(o: V2, size: SpotSize, faces: readonly SpotFace[], work: { width: number; height: number }): number;
  export interface OwnerCtx { faces: readonly { person: PersonId; face: Face }[]; bodies: readonly { person: PersonId; mask: PersonMask }[]; aspect: number }
  export function ownerCtxOf(detect: Pick<DetectionCache, 'persons' | 'bodies'> | null, faces: readonly SpotFace[], aspect: number): OwnerCtx;
  export function ownerAt(o: V2, ctx: OwnerCtx): PersonId | null;
  export interface Patch { data: ArrayLike<number>; w: number; h: number; rect: Rect; pxPerShort: number }
  export interface PlanCtx { faces: readonly SpotFace[]; aspect: number; existing: readonly Spot[] }
  export type PlanResult = Spot | { refused: 'eye' | 'mouth' | 'cap' };
  export function planSpot(patch: Patch, tap: V2, r: number, ctx: PlanCtx): PlanResult; // owner null; the caller sets it
  ```
  (`src/edit/patch.ts`):
  ```ts
  export const PATCH_MAX_SIDE = 112;
  export interface PatchPlan { sx: number; sy: number; sw: number; sh: number; w: number; h: number; rect: Rect; pxPerShort: number }
  export function patchPlan(o: V2, r: number, work: { width: number; height: number }): PatchPlan;  // pure
  export function readPatch(bitmap: CanvasImageSource, plan: PatchPlan): Patch;                   // DOM (2D canvas)
  ```

- [ ] **Step 1: Write the failing tests**

Append to `src/edit/spots.test.ts` (add to its imports: `readFileSync` from `node:fs`; `adapt` from `../tracking/adapter111`; `type Face` from `../types` (merged with the existing `type EditState, type Spot`); and to the `./spots` import: `ownerAt`, `planSpot`, `regionAt`, `spotRadius`, `SPOT_K`, `type Patch`, `type SpotFace`):
```ts
const lm = JSON.parse(readFileSync(new URL('../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as { width: number; height: number; points: number[] };
const FACE: Face = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);
const ASPECT = lm.width / lm.height;
const FACES: SpotFace[] = [{ id: 'f0', face: FACE }];
const WORK = { width: 1000, height: 1500 };
const P = (i: number): [number, number] => [FACE.pts111[i * 2], FACE.pts111[i * 2 + 1]];
const mid = (a: [number, number], b: [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const hash = (x: number, y: number) => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s) - 0.5;
};
/** a patch covering the whole (square) O of `n` px, filled from luma(x, y) on a skin tint */
function patch(n: number, luma: (x: number, y: number) => number, rect = { x: 0, y: 0, w: 1, h: 1 }): Patch {
  const data = new Uint8ClampedArray(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const v = luma(x + 0.5, y + 0.5);
      data.set([Math.round(255 * Math.min(1, v * 1.15)), Math.round(255 * v * 0.92), Math.round(255 * v * 0.8), 255], (y * n + x) * 4);
    }
  return { data, w: n, h: n, rect, pxPerShort: n / rect.w };
}

describe('regionAt / spotRadius / ownerAt (skin-cleanup spec §2.3, §3.3)', () => {
  it('tells the eyes, the open mouth, the lips, the skin and the rest apart', () => {
    expect(regionAt(P(74), FACES, ASPECT)).toEqual({ kind: 'eye', face: 'f0' });
    expect(regionAt(mid(P(98), P(102)), FACES, ASPECT)).toEqual({ kind: 'mouth', face: 'f0' });
    expect(regionAt(mid(P(87), P(98)), FACES, ASPECT)).toEqual({ kind: 'lip', face: 'f0' });
    expect(regionAt(mid(P(6), P(82)), FACES, ASPECT)).toEqual({ kind: 'skin', face: 'f0' });
    expect(regionAt([0.03, 0.03], FACES, ASPECT)).toEqual({ kind: 'other' });
  });

  it('sizes the spot by the reference face: own oval, a padded box, the median width, else 0.35 of the short edge', () => {
    const fwShort = 0.5888; // 588.8 px on a 1000 px short edge
    expect(spotRadius(mid(P(6), P(82)), 'M', FACES, WORK)).toBeCloseTo(SPOT_K.M * fwShort, 3);
    expect(spotRadius([P(0)[0] - 0.02, P(0)[1]], 'S', FACES, WORK)).toBeCloseTo(SPOT_K.S * fwShort, 3); // just outside the oval, inside the box ×1.5
    expect(spotRadius([0.02, 0.98], 'L', FACES, WORK)).toBeCloseTo(SPOT_K.L * fwShort, 3); // outside every grown box: the median face
    expect(spotRadius([0.5, 0.5], 'M', [], WORK)).toBeCloseTo(0.03 * 0.35, 6);
    expect(spotRadius([0.5, 0.5], 'S', [], { width: 100, height: 100 })).toBeCloseTo(0.03, 6); // 3 working px floor
    expect(spotRadius([0.5, 0.5], 'L', [{ id: 'f0', face: { ...FACE, pts111: FACE.pts111.map((v, i) => (i % 2 ? v : v * 3 - 1)) } }], WORK)).toBeLessThanOrEqual(0.04);
  });

  it('owner: the face region first, else the highest body mask ≥ 0.5 (the smaller mask on a tie), else null', () => {
    const mask = (fill: (x: number, y: number) => number) => {
      const data = new Uint8Array(64 * 96);
      for (let y = 0; y < 96; y++) for (let x = 0; x < 64; x++) data[y * 64 + x] = fill(x, y);
      return { width: 64, height: 96, data };
    };
    const ctx = {
      faces: [{ person: 'f0', face: FACE }],
      bodies: [
        { person: 'b0', mask: mask((x) => (x < 32 ? 200 : 0)) },
        { person: 'b1', mask: mask((x, y) => (x < 32 && y > 48 ? 250 : 0)) },
      ],
      aspect: ASPECT,
    };
    expect(ownerAt(mid(P(6), P(82)), ctx)).toBe('f0');
    expect(ownerAt([0.1, 0.9], ctx)).toBe('b1');
    expect(ownerAt([0.1, 0.2], ctx)).toBe('b0');
    expect(ownerAt([0.9, 0.95], ctx)).toBeNull();
  });
});

describe('planSpot (§3.5)', () => {
  const r = 10 / 200; // 10 patch px on a 200 px patch
  const dot = (cx: number, cy: number) => (x: number, y: number) => 0.62 + 0.02 * hash(x, y) - 0.2 * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * 3.5 ** 2));

  it('snaps to a blemish within 1 px when the tap is within 0.8 r, and keeps the tap on clean skin', () => {
    const s = planSpot(patch(200, dot(100, 100)), [106 / 200, 103 / 200], r, { faces: [], aspect: 1, existing: [] }) as Spot;
    expect(Math.hypot(s.x * 200 - 100, s.y * 200 - 100)).toBeLessThanOrEqual(1);
    const flat = planSpot(patch(200, (x, y) => 0.62 + 0.02 * hash(x, y)), [0.4, 0.6], r, { faces: [], aspect: 1, existing: [] }) as Spot;
    expect([flat.x, flat.y]).toEqual([0.4, 0.6]);
  });

  it('prefers a donor whose ring differs by a constant over a closer-toned one with a mismatched texture', () => {
    // spot at (100,100) with fine texture T; at +32 px the same texture 0.05 brighter; at −32 px the same tone, coarse noise
    const T = (x: number, y: number) => 0.02 * hash(Math.floor(x), Math.floor(y));
    const img = (x: number, y: number) => {
      const near = (cx: number) => Math.hypot(x - cx, y - 100) <= 16;
      if (near(100)) return 0.6 + T(x - 100, y - 100);
      if (near(132)) return 0.65 + T(x - 132, y - 100);
      if (near(68)) return 0.6 + 0.08 * hash(x * 3.1, y * 1.7);
      return 0.6 + 0.1 * hash(x * 0.37, y * 5.3);
    };
    const s = planSpot(patch(200, img), [100 / 200, 100 / 200], r, { faces: [], aspect: 1, existing: [] }) as Spot;
    expect([Math.round(s.dx * 200), Math.round(s.dy * 200)]).toEqual([32, 0]);
  });

  it('keeps a lip spot’s donor on the lip of the same face (never lip-to-skin)', () => {
    const o = mid(P(93), P(102)); // the middle of the lower lip, ≈ 57 px thick on the fixture
    const rr = 0.006; // 6 px on the 1000 px short edge
    const half = 5.6 * rr;
    const rect = { x: o[0] - half, y: o[1] - half * ASPECT, w: 2 * half, h: 2 * half * ASPECT };
    const s = planSpot(patch(112, (x, y) => 0.55 + 0.02 * hash(x, y), rect), o, rr, { faces: FACES, aspect: ASPECT, existing: [] }) as Spot;
    expect(regionAt([s.x, s.y], FACES, ASPECT)).toEqual({ kind: 'lip', face: 'f0' });
    expect([s.dx, s.dy]).not.toEqual([0, 0]);
    expect(regionAt([s.x + s.dx, s.y + s.dy * ASPECT], FACES, ASPECT)).toEqual({ kind: 'lip', face: 'f0' });
  });

  it('respects the image edge and existing spots; fill mode when nothing fits; deterministic', () => {
    const img = (x: number, y: number) => 0.62 + 0.02 * hash(x, y);
    const near = planSpot(patch(200, img), [14 / 200, 100 / 200], r, { faces: [], aspect: 1, existing: [] }) as Spot;
    expect(near.x * 200 + near.dx * 200 - 1.4 * 10).toBeGreaterThanOrEqual(0);
    const first = planSpot(patch(200, img), [0.5, 0.5], r, { faces: [], aspect: 1, existing: [] }) as Spot;
    const blocker = { x: first.x + first.dx, y: first.y + first.dy, r, dx: 0, dy: 0, owner: null };
    const second = planSpot(patch(200, img), [0.5, 0.5], r, { faces: [], aspect: 1, existing: [blocker] }) as Spot;
    expect(Math.hypot((second.x + second.dx - blocker.x) * 200, (second.y + second.dy - blocker.y) * 200)).toBeGreaterThanOrEqual(1.1 * 20 - 1e-9);
    const tiny = planSpot(patch(40, img), [0.5, 0.5], 10 / 40, { faces: [], aspect: 1, existing: [] }) as Spot;
    expect([tiny.dx, tiny.dy]).toEqual([0, 0]);
    expect(planSpot(patch(200, img), [0.5, 0.5], r, { faces: [], aspect: 1, existing: [] })).toEqual(first);
  });

  it('never takes a donor across eyes, the mouth, a lip edge or another face', () => {
    const below = mid(P(73), P(57));
    const o: [number, number] = [below[0], below[1] + 0.03];
    const rect = { x: o[0] - 0.08, y: o[1] - 0.08 * ASPECT, w: 0.16, h: 0.16 * ASPECT }; // 160 × 160 px
    const pp = patch(112, (x, y) => 0.62 + 0.02 * hash(x, y), rect);
    pp.pxPerShort = 112 / rect.w;
    const rr = 0.012;
    const s = planSpot(pp, o, rr, { faces: FACES, aspect: ASPECT, existing: [] }) as Spot;
    const donor: [number, number] = [s.x + s.dx, s.y + s.dy * ASPECT];
    expect(regionAt(donor, FACES, ASPECT).kind).toBe('skin');
    for (let j = 0; j < 8; j++) {
      const a = (j * Math.PI) / 4;
      const rim: [number, number] = [donor[0] + 1.1 * rr * Math.cos(a), donor[1] + 1.1 * rr * Math.sin(a) * ASPECT];
      expect(['eye', 'mouth']).not.toContain(regionAt(rim, FACES, ASPECT).kind);
    }
  });

  it('refuses eyes, the open mouth and a full list', () => {
    const img = (x: number, y: number) => 0.62 + 0.02 * hash(x, y);
    expect(planSpot(patch(200, img), P(74), r, { faces: FACES, aspect: ASPECT, existing: [] })).toEqual({ refused: 'eye' });
    expect(planSpot(patch(200, img), mid(P(98), P(102)), r, { faces: FACES, aspect: ASPECT, existing: [] })).toEqual({ refused: 'mouth' });
    const full = Array.from({ length: SPOT_CAP }, (_, i) => ({ x: i / 100, y: 0.1, r, dx: 0, dy: 0, owner: null }));
    expect(planSpot(patch(200, img), [0.5, 0.5], r, { faces: [], aspect: 1, existing: full })).toEqual({ refused: 'cap' });
  });
});
```
(The donor test converts the donor offset from short-edge units to normalized O: on a 1000 × 1500 photo the short edge is the width, so dx is already in width units and dy × aspect gives height units.)

Create `src/edit/patch.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { PATCH_MAX_SIDE, patchPlan } from './patch';

describe('patchPlan (skin-cleanup spec §3.4 step 4)', () => {
  const work = { width: 1000, height: 1500 };
  it('reads the square of half-side 5.6 r around the tap, r at 6–10 patch px, side ≤ 112', () => {
    for (const r of [0.003, 0.008, 0.0177, 0.04]) {
      const p = patchPlan([0.4, 0.5], r, work);
      const rPatch = r * p.pxPerShort;
      expect(rPatch).toBeGreaterThanOrEqual(6 - 0.2);
      expect(rPatch).toBeLessThanOrEqual(10 + 0.2);
      expect(Math.max(p.w, p.h)).toBeLessThanOrEqual(PATCH_MAX_SIDE);
      expect(p.sw).toBeCloseTo(11.2 * r * 1000, -1);
    }
  });
  it('clips at the photo edge', () => {
    const p = patchPlan([0.001, 0.999], 0.02, work);
    expect(p.sx).toBe(0);
    expect(p.sy + p.sh).toBe(1500);
    expect(p.rect.x).toBe(0);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/edit/spots.test.ts src/edit/patch.test.ts`
Expected: FAIL — `regionAt is not a function` and `Failed to resolve import "./patch"`.

- [ ] **Step 3: Implement**

`src/media/exporter.ts` (LF) — step 3 already exports `createSurface(width, height, opts: SurfaceOptions = {})` (`exporter.ts:129`), `Surface` (`:114`) and `SurfaceOptions { type?; alpha? }` (`:121-126`) (step-3 plan Task 5). Add to `SurfaceOptions`
```ts
  /** the patch reader reads its pixels back on every tap (skin-cleanup spec §3.4) */
  willReadFrequently?: boolean;
```
and replace its line (`exporter.ts:132`, under its comment about the annotation)
`const ctxOpts: CanvasRenderingContext2DSettings | undefined = opts.alpha === false ? { alpha: false } : undefined;` with
```ts
  const settings: CanvasRenderingContext2DSettings = {};
  if (opts.alpha === false) settings.alpha = false;
  if (opts.willReadFrequently) settings.willReadFrequently = true;
  const ctxOpts: CanvasRenderingContext2DSettings | undefined = Object.keys(settings).length ? settings : undefined;
```
Both `getContext('2d', ctxOpts)` calls (OffscreenCanvas and the `<canvas>` fallback) already take `ctxOpts`, and every existing caller still gets exactly step 3's settings.

Append to `src/edit/spots.ts` (merge the imports with the existing ones):
```ts
import type { DetectionCache, Face, PersonMask, Rect, SpotSize } from '../types';

export type V2 = [number, number];

/** 祛痘 大小: radius = k × the reference face width (S §2.3) */
export const SPOT_K: Record<SpotSize, number> = { S: 0.018, M: 0.03, L: 0.048 };

export interface SpotFace {
  /** the cached face id (f0…) */
  id: string;
  /** the adapted face, O-normalized */
  face: Face;
}
export type RegionKind = 'eye' | 'mouth' | 'lip' | 'skin' | 'other';
export interface Region {
  kind: RegionKind;
  face?: string;
}

const EYE: Record<'L' | 'R', readonly number[]> = { L: [52, 53, 72, 54, 55, 56, 73, 57], R: [58, 59, 75, 60, 61, 62, 76, 63] };
const INNER_LIP = [96, 97, 98, 99, 100, 101, 102, 103];
const OUTER_LIP = [84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95];

const isoOf = (f: Face, i: number, aspect: number): V2 => [f.pts111[i * 2], f.pts111[i * 2 + 1] / aspect];
const isoPoly = (f: Face, idx: readonly number[], aspect: number): V2[] => idx.map((i) => isoOf(f, i, aspect));
const ovalIso = (f: Face, aspect: number): V2[] => Array.from({ length: f.oval.length / 2 }, (_, i): V2 => [f.oval[i * 2], f.oval[i * 2 + 1] / aspect]);
const dist = (a: V2, b: V2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function inPolygon(p: V2, poly: readonly V2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function grown(poly: readonly V2[], d: number): V2[] {
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  return poly.map(([x, y]) => {
    const l = Math.hypot(x - cx, y - cy);
    return l > 1e-12 ? [x + ((x - cx) / l) * d, y + ((y - cy) / l) * d] : [x, y];
  });
}

/**
 * Where an O point lies (S §3.3): an eye ring padded by 0.15 eye width → eye; the inner lips → mouth; the outer lips
 * minus the inner → lip; the oval → skin of that face; anything else → other. Eyes and mouths of every face win first.
 */
export function regionAt(o: V2, faces: readonly SpotFace[], aspect: number): Region {
  const q: V2 = [o[0], o[1] / aspect];
  for (const { id, face } of faces) {
    for (const side of ['L', 'R'] as const) {
      const ring = isoPoly(face, EYE[side], aspect);
      if (inPolygon(q, grown(ring, 0.15 * dist(ring[0], ring[4])))) return { kind: 'eye', face: id };
    }
    if (inPolygon(q, isoPoly(face, INNER_LIP, aspect))) return { kind: 'mouth', face: id };
  }
  for (const { id, face } of faces) {
    if (inPolygon(q, isoPoly(face, OUTER_LIP, aspect))) return { kind: 'lip', face: id };
    if (inPolygon(q, ovalIso(face, aspect))) return { kind: 'skin', face: id };
  }
  return { kind: 'other' };
}

/**
 * Spot radius (fraction of the O short edge): k × the reference face width — the face whose oval holds the tap, else the
 * nearest face whose box grown by 50 % holds it, else the median face width, else 0.35 × the short edge — clamped to
 * [3 working px, 0.04].
 */
export function spotRadius(o: V2, size: SpotSize, faces: readonly SpotFace[], work: { width: number; height: number }): number {
  const aspect = work.width / work.height;
  const short = Math.min(work.width, work.height);
  const fw = (f: Face) => (dist(isoOf(f, 0, aspect), isoOf(f, 32, aspect)) * work.width) / short;
  const q: V2 = [o[0], o[1] / aspect];
  let ref: number | null = null;
  const holder = faces.find((f) => inPolygon(q, ovalIso(f.face, aspect)));
  if (holder) ref = fw(holder.face);
  else {
    let best = Infinity;
    for (const f of faces) {
      const xs: number[] = [];
      const ys: number[] = [];
      for (let i = 0; i < f.face.oval.length; i += 2) {
        xs.push(f.face.oval[i]);
        ys.push(f.face.oval[i + 1]);
      }
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const hw = (0.75 * (Math.max(...xs) - Math.min(...xs)));
      const hh = (0.75 * (Math.max(...ys) - Math.min(...ys)));
      if (Math.abs(o[0] - cx) > hw || Math.abs(o[1] - cy) > hh) continue;
      const d = Math.hypot(o[0] - cx, (o[1] - cy) / aspect);
      if (d < best) {
        best = d;
        ref = fw(f.face);
      }
    }
    if (ref === null && faces.length) {
      const ws = faces.map((f) => fw(f.face)).sort((a, b) => a - b);
      ref = ws.length % 2 ? ws[(ws.length - 1) / 2] : (ws[ws.length / 2 - 1] + ws[ws.length / 2]) / 2;
    }
  }
  return Math.min(0.04, Math.max(3 / short, SPOT_K[size] * (ref ?? 0.35)));
}

export interface OwnerCtx {
  faces: readonly { person: PersonId; face: Face }[];
  bodies: readonly { person: PersonId; mask: PersonMask }[];
  aspect: number;
}

/** the face and body-mask owners of the detection cache (persons link faces and bodies by id) */
export function ownerCtxOf(detect: Pick<DetectionCache, 'persons' | 'bodies'> | null, faces: readonly SpotFace[], aspect: number): OwnerCtx {
  const persons = detect?.persons ?? [];
  const byFace = new Map(persons.filter((p) => p.face).map((p) => [p.face as string, p.id]));
  const byBody = new Map(persons.filter((p) => p.body).map((p) => [p.body as string, p.id]));
  return {
    faces: faces.flatMap((f) => (byFace.has(f.id) ? [{ person: byFace.get(f.id)!, face: f.face }] : [])),
    bodies: (detect?.bodies ?? []).flatMap((b) => (b.mask && byBody.has(b.id) ? [{ person: byBody.get(b.id)!, mask: b.mask }] : [])),
    aspect,
  };
}

function maskAt(m: PersonMask, o: V2): number {
  const x = Math.min(m.width - 1, Math.max(0, o[0] * m.width - 0.5));
  const y = Math.min(m.height - 1, Math.max(0, o[1] * m.height - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(m.width - 1, x0 + 1);
  const y1 = Math.min(m.height - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const v = (xx: number, yy: number) => m.data[yy * m.width + xx] / 255;
  return (v(x0, y0) * (1 - fx) + v(x1, y0) * fx) * (1 - fy) + (v(x0, y1) * (1 - fx) + v(x1, y1) * fx) * fy;
}
const maskArea = (m: PersonMask) => m.data.reduce((s, v) => s + (v >= 128 ? 1 : 0), 0);

/** the person a spot belongs to (S §3.3): the face region first, else the highest body mask ≥ 0.5, else null */
export function ownerAt(o: V2, ctx: OwnerCtx): PersonId | null {
  const reg = regionAt(o, ctx.faces.map((f) => ({ id: f.person, face: f.face })), ctx.aspect);
  if (reg.kind !== 'other' && reg.face) return reg.face;
  let best: { person: PersonId; v: number; area: number } | null = null;
  for (const b of ctx.bodies) {
    const v = maskAt(b.mask, o);
    if (v < 0.5) continue;
    const area = maskArea(b.mask);
    if (!best || v > best.v || (v === best.v && area < best.area)) best = { person: b.person, v, area };
  }
  return best?.person ?? null;
}

/** RGBA8 pixels of the working bitmap around a tap (patch.ts); `rect` is the O rectangle they cover */
export interface Patch {
  data: ArrayLike<number>;
  w: number;
  h: number;
  rect: Rect;
  /** patch px per O short edge */
  pxPerShort: number;
}
export interface PlanCtx {
  faces: readonly SpotFace[];
  aspect: number;
  existing: readonly Spot[];
}
export type PlanResult = Spot | { refused: 'eye' | 'mouth' | 'cap' };

/** integer offsets within the annulus r0 ≤ |o| ≤ r1 (a disc for r0 = 0) */
function offsets(r0: number, r1: number): [number, number][] {
  const out: [number, number][] = [];
  const n = Math.ceil(r1);
  for (let y = -n; y <= n; y++) for (let x = -n; x <= n; x++) if (x * x + y * y >= r0 * r0 && x * x + y * y <= r1 * r1) out.push([x, y]);
  return out;
}

class PatchView {
  readonly Y: Float32Array;
  readonly Cr: Float32Array;
  readonly rgb: Float32Array;
  constructor(readonly p: Patch) {
    const n = p.w * p.h;
    this.Y = new Float32Array(n);
    this.Cr = new Float32Array(n);
    this.rgb = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = p.data[i * 4] / 255;
      const g = p.data[i * 4 + 1] / 255;
      const b = p.data[i * 4 + 2] / 255;
      this.rgb.set([r, g, b], i * 3);
      this.Y[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      this.Cr[i] = 0.5 + 0.5 * r - 0.418688 * g - 0.081312 * b;
    }
  }
  idx(x: number, y: number): number {
    return Math.min(this.p.h - 1, Math.max(0, y)) * this.p.w + Math.min(this.p.w - 1, Math.max(0, x));
  }
  /** O → patch px (continuous; pixel centres at i + 0.5) */
  toPatch(o: V2): V2 {
    return [((o[0] - this.p.rect.x) / this.p.rect.w) * this.p.w, ((o[1] - this.p.rect.y) / this.p.rect.h) * this.p.h];
  }
  toO(q: V2): V2 {
    return [this.p.rect.x + (q[0] / this.p.w) * this.p.rect.w, this.p.rect.y + (q[1] / this.p.h) * this.p.rect.h];
  }
  mean(plane: Float32Array, cx: number, cy: number, offs: readonly [number, number][]): number {
    let s = 0;
    for (const [dx, dy] of offs) s += plane[this.idx(cx + dx, cy + dy)];
    return s / offs.length;
  }
  sd(cx: number, cy: number, offs: readonly [number, number][]): number {
    const m = this.mean(this.Y, cx, cy, offs);
    let s = 0;
    for (const [dx, dy] of offs) s += (this.Y[this.idx(cx + dx, cy + dy)] - m) ** 2;
    return Math.sqrt(s / offs.length);
  }
  /** mean |Y − box3(Y)| over the offsets */
  hf(cx: number, cy: number, offs: readonly [number, number][]): number {
    let s = 0;
    for (const [dx, dy] of offs) {
      const x = cx + dx;
      const y = cy + dy;
      let b = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) b += this.Y[this.idx(x + i, y + j)];
      s += Math.abs(this.Y[this.idx(x, y)] - b / 9);
    }
    return s / offs.length;
  }
  /** bilinear RGB at continuous patch px */
  rgbAt(x: number, y: number, out: number[]): number[] {
    const fx = x - 0.5;
    const fy = y - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const ax = fx - x0;
    const ay = fy - y0;
    const i00 = this.idx(x0, y0) * 3;
    const i10 = this.idx(x0 + 1, y0) * 3;
    const i01 = this.idx(x0, y0 + 1) * 3;
    const i11 = this.idx(x0 + 1, y0 + 1) * 3;
    for (let c = 0; c < 3; c++) out[c] = (this.rgb[i00 + c] * (1 - ax) + this.rgb[i10 + c] * ax) * (1 - ay) + (this.rgb[i01 + c] * (1 - ax) + this.rgb[i11 + c] * ax) * ay;
    return out;
  }
}

const l1 = (a: ArrayLike<number>) => (Math.abs(a[0]) + Math.abs(a[1]) + Math.abs(a[2])) / 3;

/**
 * The spot for a tap (S §3.5, deterministic): snap the centre to the blemish within 0.8 r, choose the donor among 16
 * offsets ({2.4 r, 3.2 r} × 8 directions) by the ring-mismatch cost, or fill mode (dx = dy = 0) when none is valid.
 * `owner` is null (the editor sets it with ownerAt). Units: x, y normalized O; r, dx, dy fractions of the O short edge.
 */
export function planSpot(patch: Patch, tap: V2, r: number, ctx: PlanCtx): PlanResult {
  if (ctx.existing.length >= SPOT_CAP) return { refused: 'cap' };
  const at = regionAt(tap, ctx.faces, ctx.aspect);
  if (at.kind === 'eye' || at.kind === 'mouth') return { refused: at.kind };
  const P = new PatchView(patch);
  const rp = r * patch.pxPerShort;
  const t = P.toPatch(tap);
  const core = offsets(0, 0.5 * rp);
  const ann = offsets(1.3 * rp, 1.6 * rp);
  const disc = offsets(0, rp);

  // snap: s(x) = max(0, Ȳ_ring − Ȳ_core) + 0.6·max(0, C̄r_core − C̄r_ring) over pixel centres within 0.8 r of the tap
  let best = -1;
  let bestD = Infinity;
  let snapped: V2 = t;
  const reach = 0.8 * rp;
  for (let y = Math.floor(t[1] - reach); y <= Math.ceil(t[1] + reach); y++)
    for (let x = Math.floor(t[0] - reach); x <= Math.ceil(t[0] + reach); x++) {
      const d = Math.hypot(x + 0.5 - t[0], y + 0.5 - t[1]);
      if (d > reach || x < 0 || y < 0 || x >= patch.w || y >= patch.h) continue;
      const s = Math.max(0, P.mean(P.Y, x, y, ann) - P.mean(P.Y, x, y, core)) + 0.6 * Math.max(0, P.mean(P.Cr, x, y, core) - P.mean(P.Cr, x, y, ann));
      if (s > best + 1e-12 || (Math.abs(s - best) <= 1e-12 && d < bestD)) {
        best = s;
        bestD = d;
        snapped = [x + 0.5, y + 0.5];
      }
    }
  const moved = best >= 0.015;
  let c: V2 = moved ? snapped : t;
  let cO: V2 = moved ? P.toO(snapped) : tap;
  let reg = regionAt(cO, ctx.faces, ctx.aspect);
  if (reg.kind === 'eye' || reg.kind === 'mouth') {
    c = t;
    cO = tap;
    reg = at;
  }

  // donor
  const N = 32;
  const T: number[][] = [];
  for (let k = 0; k < N; k++) {
    const a = (2 * Math.PI * k) / N;
    T.push(P.rgbAt(c[0] + 1.3 * rp * Math.cos(a), c[1] + 1.3 * rp * Math.sin(a), [0, 0, 0]));
  }
  const ci = [Math.floor(c[0]), Math.floor(c[1])] as const;
  const hfSpot = P.hf(ci[0], ci[1], ann);
  const others = ctx.existing.map((s) => ({ c: P.toPatch([s.x, s.y]), r: s.r * patch.pxPerShort }));
  let bestE = Infinity;
  let donor: V2 | null = null;
  const D = [0, 0, 0];
  for (const k of [2.4, 3.2])
    for (let j = 0; j < 8; j++) {
      const a = (j * Math.PI) / 4;
      const off: V2 = [k * rp * Math.cos(a), k * rp * Math.sin(a)];
      const dc: V2 = [c[0] + off[0], c[1] + off[1]];
      if (dc[0] - 1.4 * rp < 0 || dc[1] - 1.4 * rp < 0 || dc[0] + 1.4 * rp > patch.w || dc[1] + 1.4 * rp > patch.h) continue;
      const dreg = regionAt(P.toO(dc), ctx.faces, ctx.aspect);
      if (dreg.kind !== reg.kind || dreg.face !== reg.face) continue;
      let rimOk = true;
      for (let m = 0; m < 8 && rimOk; m++) {
        const b = (m * Math.PI) / 4;
        const kind = regionAt(P.toO([dc[0] + 1.1 * rp * Math.cos(b), dc[1] + 1.1 * rp * Math.sin(b)]), ctx.faces, ctx.aspect).kind;
        rimOk = kind !== 'eye' && kind !== 'mouth';
      }
      if (!rimOk) continue;
      if (others.some((o) => Math.hypot(dc[0] - o.c[0], dc[1] - o.c[1]) < 1.1 * (rp + o.r))) continue;
      const deltas: number[][] = [];
      const mean = [0, 0, 0];
      for (let n = 0; n < N; n++) {
        const b = (2 * Math.PI * n) / N;
        P.rgbAt(dc[0] + 1.3 * rp * Math.cos(b), dc[1] + 1.3 * rp * Math.sin(b), D);
        const dd = [T[n][0] - D[0], T[n][1] - D[1], T[n][2] - D[2]];
        deltas.push(dd);
        for (let q = 0; q < 3; q++) mean[q] += dd[q] / N;
      }
      let mismatch = 0;
      for (const dd of deltas) mismatch += l1([dd[0] - mean[0], dd[1] - mean[1], dd[2] - mean[2]]) / N;
      const di = [Math.floor(dc[0]), Math.floor(dc[1])] as const;
      const E =
        mismatch +
        0.25 * l1(mean) +
        2 * Math.max(0, P.sd(di[0], di[1], disc) - 1.5 * P.sd(di[0], di[1], ann)) +
        0.5 * Math.abs(P.hf(di[0], di[1], disc) - hfSpot);
      if (E < bestE) {
        bestE = E;
        donor = off;
      }
    }
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  return {
    x: clamp01(cO[0]),
    y: clamp01(cO[1]),
    r,
    dx: donor ? donor[0] / patch.pxPerShort : 0,
    dy: donor ? donor[1] / patch.pxPerShort : 0,
    owner: null,
  };
}
```
Create `src/edit/patch.ts`:
```ts
// 祛痘 patch (skin-cleanup spec §3.4 step 4): the square of half-side 5.6 r around the tap — the farthest donor ring after
// the largest snap (0.8 r + 3.2 r + 1.4 r = 5.4 r) plus a 0.2 r margin — read from the working bitmap through one reused
// 2D surface, scaled so r is 6–10 patch px and the side ≤ 112 px. It only steers the snap and the donor choice; the heal
// samples the GPU source, so a colour-management difference between 2D canvas and WebGL cannot misplace pixels.
import { createSurface, type Surface } from '../media/exporter';
import type { Rect } from '../types';
import type { Patch, V2 } from './spots';

export const PATCH_MAX_SIDE = 112;

export interface PatchPlan {
  /** source rectangle in working px */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** patch size in px */
  w: number;
  h: number;
  /** the O rectangle covered */
  rect: Rect;
  pxPerShort: number;
}

export function patchPlan(o: V2, r: number, work: { width: number; height: number }): PatchPlan {
  const short = Math.min(work.width, work.height);
  const rPx = Math.max(1e-6, r * short);
  const hs = 5.6 * rPx;
  const cx = o[0] * work.width;
  const cy = o[1] * work.height;
  const sx = Math.max(0, Math.round(cx - hs));
  const sy = Math.max(0, Math.round(cy - hs));
  const sw = Math.max(1, Math.min(work.width, Math.round(cx + hs)) - sx);
  const sh = Math.max(1, Math.min(work.height, Math.round(cy + hs)) - sy);
  const scale = Math.min(rPx < 6 ? 6 / rPx : rPx > 10 ? 10 / rPx : 1, PATCH_MAX_SIDE / sw, PATCH_MAX_SIDE / sh);
  const w = Math.max(1, Math.min(PATCH_MAX_SIDE, Math.round(sw * scale)));
  const h = Math.max(1, Math.min(PATCH_MAX_SIDE, Math.round(sh * scale)));
  return { sx, sy, sw, sh, w, h, rect: { x: sx / work.width, y: sy / work.height, w: sw / work.width, h: sh / work.height }, pxPerShort: (w / sw) * short };
}

let surface: Surface | null = null;

/** The patch pixels. DOM: OffscreenCanvas, else a detached <canvas>; throws when no 2D context exists. */
export function readPatch(bitmap: CanvasImageSource, plan: PatchPlan): Patch {
  surface ??= createSurface(PATCH_MAX_SIDE, PATCH_MAX_SIDE, { type: 'image/png', alpha: false, willReadFrequently: true });
  const ctx = surface.ctx;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, PATCH_MAX_SIDE, PATCH_MAX_SIDE);
  ctx.drawImage(bitmap, plan.sx, plan.sy, plan.sw, plan.sh, 0, 0, plan.w, plan.h);
  const img = ctx.getImageData(0, 0, plan.w, plan.h);
  return { data: img.data, w: plan.w, h: plan.h, rect: plan.rect, pxPerShort: plan.pxPerShort };
}
```
(`type` is irrelevant here because the patch is never encoded.)

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/edit src/media && npm run typecheck`
Expected: PASS (the existing `exporter.test.ts` cases unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/edit/spots.ts src/edit/spots.test.ts src/edit/patch.ts src/edit/patch.test.ts src/media/exporter.ts
git commit -m "v0.4 step 4 (13/20): spot planning — radius, regions, owner, snap, donor; patch reader" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: The heal pass P0b on the GPU

**Files:**
- Create: `src/engine/passes/heal.ts`
- Modify: `src/engine/pipeline.ts` (P0b before the Task 11 block; `FbName` += `'RING'`; `dispose`)
- Test: `tests/e2e/pages/tone.ts` (`runToneHeal`), `tests/e2e/tone-engine.spec.ts`

**Interfaces:**
- Consumes: Task 12 shaders and `healCpu`, Task 13 `planSpot`, `spotRadius`, `patchPlan`, `readPatch`; Task 10 `full()`; Task 11 `ToneJob.spots`; `COPY_FS`, `FULLSCREEN_VS`, `createProgram`, `bindTarget`, `bindTexture`, `drawFullscreen` (`gl.ts`).
- Produces:
  ```ts
  export function packSpots(spots: readonly Spot[]): Float32Array;   // x, y, r, fill, dx, dy per spot
  export interface HealPass { draw(src: Texture, dst: Framebuffer, ring: Framebuffer, spots: readonly Spot[], win: Win, srcSize: Size): void; dispose(): void }
  export function createHealPass(gl: GL): HealPass;
  // pipeline: passes gain 'heal'; base0 of P0c/P0d is the heal output
  // tests/e2e/pages/tone.ts: window.runToneHeal()
  ```

- [ ] **Step 1: Write the failing test**

Add to `tests/e2e/pages/tone.ts` (imports at the top: `createHealPass` from `../../../src/engine/passes/heal`; `patchPlan`, `readPatch` from `../../../src/edit/patch`; `planSpot`, `spotRadius` from `../../../src/edit/spots`; `HEAL_RING_SAMPLES` from `../../../src/config/limits`):
```ts
declare global {
  interface Window {
    runToneHeal?: () => Promise<{ spots: Spot[]; out: string; err: number; passes: { none: string[]; spots: string[] } }>;
  }
}

/** the three fixture blemishes planned as the editor plans a tap (中), plus a border spot in fill mode */
window.runToneHeal = async () => {
  const bmp = await fixtureBitmap();
  const fx = (await (await fetch('/tests/fixtures/sample_face_tone.json')).json()) as { defects: { name: string; center: [number, number] }[] };
  const faces = [{ id: 'f0', face: FACE }];
  const work = { width: W, height: H };
  const spots: Spot[] = [];
  for (const name of ['dot1', 'dot2', 'dot3']) {
    const c = fx.defects.find((d) => d.name === name)!.center;
    const o: [number, number] = [c[0] / W, c[1] / H];
    const r = spotRadius(o, 'M', faces, work);
    const res = planSpot(readPatch(bmp, patchPlan(o, r, work)), o, r, { faces, aspect: ASPECT, existing: spots });
    if ('refused' in res) throw new Error(`${name} refused: ${res.refused}`);
    spots.push(res);
  }
  spots.push({ x: 0.004, y: 0.5, r: 0.02, dx: 0, dy: 0, owner: null });
  const gl = glOf();
  const src = createTexture(gl, 0, 0);
  uploadSource(gl, src, bmp, W, H);
  const heal = createHealPass(gl);
  const a = createFramebuffer(gl, W, H);
  const ring = createFramebuffer(gl, HEAL_RING_SAMPLES, spots.length);
  heal.draw(src, a, ring, spots, IDENTITY_WIN, { width: W, height: H });
  const out = b64(readFb(gl, a));
  const err = gl.getError();
  heal.dispose();
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const engine = createEngine(canvas, { mirror: false });
  await engine.ready;
  const passes = { none: engine.render(inputFor(bmp, NEUTRAL_TONE), { still: true }).passes, spots: engine.render(inputFor(bmp, NEUTRAL_TONE, spots), { still: true }).passes };
  engine.dispose();
  bmp.close();
  return { spots, out, err, passes };
};
```
Append to `tests/e2e/tone-engine.spec.ts` (imports: `healCpu` from `../../src/engine/healCpu`; `discStats` from `../../src/engine/toneStats.node`):
```ts
test('heal: the GPU equals healCpu within 2/255, a blemish disappears, a border spot is a smooth fill', async ({ page }) => {
  await openHarness(page, 'runToneHeal');
  const r = await page.evaluate(() => window.runToneHeal!());
  expect(r.err).toBe(0);
  const fx = loadFx();
  const src = fixturePixels();
  const cpu = toRgba8(healCpu(fromRgba8(src.width, src.height, src.data), r.spots));
  const gpu = bytes(r.out);
  let max = 0;
  for (let i = 0; i < gpu.length; i++) if (i % 4 !== 3) max = Math.max(max, Math.abs(gpu[i] - cpu[i]));
  console.log(`heal GPU vs CPU max ${max}; spots ${JSON.stringify(r.spots.map((s) => [s.x.toFixed(3), s.y.toFixed(3), s.dx.toFixed(3), s.dy.toFixed(3)]))}`);
  expect(max).toBeLessThanOrEqual(2);
  const dot = fx.defects.find((d) => d.name === 'dot1')!;
  const healed = { width: src.width, height: src.height, data: gpu };
  const disc = (img: Rgba8) => discStats(img, dot.center, 1.2 * (dot.sigma ?? 5));
  expect(disc(healed).sd).toBeLessThanOrEqual(0.4 * disc(src).sd);
  const around = discStats(healed, dot.center, 4 * (dot.sigma ?? 5)).mean;
  expect(Math.abs(disc(healed).mean - around) / around).toBeLessThanOrEqual(0.03);
  expect(r.passes.none.filter((p) => p === 'heal')).toEqual([]);
  expect(r.passes.spots).toContain('heal');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run build && npx playwright test tests/e2e/tone-engine.spec.ts -g heal`
Expected: FAIL — the page does not compile (`createHealPass` missing), so `runToneHeal` never appears.

- [ ] **Step 3: Implement**

Create `src/engine/passes/heal.ts`:
```ts
// P0b 祛痘 heal (skin-cleanup spec §4.5): copy src → dst, the robust ring pass into RING (N × spots), then one instanced
// quad per spot blended premultiplied (ONE, ONE_MINUS_SRC_ALPHA) in list order; every quad reads the unhealed src.
// Shaders: ../shaders/heal.ts. Original work.
import type { Spot } from '../../types';
import { bindTarget, bindTexture, COPY_FS, createProgram, drawFullscreen, FULLSCREEN_VS, type Framebuffer, type GL, type Program, type Texture } from '../gl/gl';
import { HEAL_FS, HEAL_RING_FS, HEAL_RING_VS, HEAL_VS } from '../shaders/heal';
import type { Size } from '../uniforms';
import type { Win } from './toneGeometry';

/** per instance: x, y, r, fill (1 = no donor), dx, dy */
export function packSpots(spots: readonly Spot[]): Float32Array {
  const out = new Float32Array(spots.length * 6);
  spots.forEach((s, i) => out.set([s.x, s.y, s.r, s.dx === 0 && s.dy === 0 ? 1 : 0, s.dx, s.dy], i * 6));
  return out;
}

export interface HealPass {
  draw(src: Texture, dst: Framebuffer, ring: Framebuffer, spots: readonly Spot[], win: Win, srcSize: Size): void;
  dispose(): void;
}

export function createHealPass(gl: GL): HealPass {
  const copy = createProgram(gl, FULLSCREEN_VS, COPY_FS, 'healCopy');
  const ringProg = createProgram(gl, HEAL_RING_VS, HEAL_RING_FS, 'healRing');
  const quadProg = createProgram(gl, HEAL_VS, HEAL_FS, 'healQuads');
  copy.use();
  gl.uniform1i(copy.u('uSrc'), 0);
  ringProg.use();
  gl.uniform1i(ringProg.u('uSrc'), 0);
  quadProg.use();
  gl.uniform1i(quadProg.u('uSrc'), 0);
  gl.uniform1i(quadProg.u('uRing'), 1);
  const corners = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const inst = gl.createBuffer();
  let instBytes = 0;
  const vaoFor = (p: Program): WebGLVertexArrayObject | null => {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const aCorner = gl.getAttribLocation(p.program, 'aCorner');
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.enableVertexAttribArray(aCorner);
    gl.vertexAttribPointer(aCorner, 2, gl.FLOAT, false, 8, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, inst);
    const aSpot = gl.getAttribLocation(p.program, 'aSpot');
    gl.enableVertexAttribArray(aSpot);
    gl.vertexAttribPointer(aSpot, 4, gl.FLOAT, false, 24, 0);
    gl.vertexAttribDivisor(aSpot, 1);
    const aDonor = gl.getAttribLocation(p.program, 'aDonor');
    gl.enableVertexAttribArray(aDonor);
    gl.vertexAttribPointer(aDonor, 2, gl.FLOAT, false, 24, 16);
    gl.vertexAttribDivisor(aDonor, 1);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    return vao;
  };
  const ringVao = vaoFor(ringProg);
  const quadVao = vaoFor(quadProg);

  return {
    draw(src, dst, ring, spots, win, srcSize) {
      gl.disable(gl.BLEND);
      copy.use();
      bindTexture(gl, 0, src);
      bindTarget(gl, dst);
      drawFullscreen(gl);
      if (!spots.length) {
        bindTexture(gl, 0, null);
        return;
      }
      const data = packSpots(spots);
      gl.bindBuffer(gl.ARRAY_BUFFER, inst);
      if (data.byteLength > instBytes) {
        instBytes = data.byteLength;
        gl.bufferData(gl.ARRAY_BUFFER, instBytes, gl.DYNAMIC_DRAW);
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      // RING (k, s)
      ringProg.use();
      gl.uniform4f(ringProg.u('uWin'), win[0], win[1], win[2], win[3]);
      gl.uniform2f(ringProg.u('uSrcPx'), srcSize.width, srcSize.height);
      gl.uniform1f(ringProg.u('uRows'), spots.length);
      bindTarget(gl, ring);
      gl.bindVertexArray(ringVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, spots.length);
      // spot quads over the copy
      quadProg.use();
      gl.uniform4f(quadProg.u('uWin'), win[0], win[1], win[2], win[3]);
      gl.uniform2f(quadProg.u('uSrcPx'), srcSize.width, srcSize.height);
      bindTexture(gl, 1, ring.tex);
      bindTarget(gl, dst);
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(quadVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, spots.length);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
      bindTexture(gl, 0, null);
      bindTexture(gl, 1, null);
    },
    dispose() {
      copy.dispose();
      ringProg.dispose();
      quadProg.dispose();
      gl.deleteVertexArray(ringVao);
      gl.deleteVertexArray(quadVao);
      gl.deleteBuffer(corners);
      gl.deleteBuffer(inst);
    },
  };
}
```
`src/engine/pipeline.ts`:
- `type FbName` gains `| 'RING'`; import `createHealPass, type HealPass` from `./passes/heal` and `HEAL_RING_SAMPLES` from `../config/limits`; state `let heal: HealPass | null = null;`; `dispose()` disposes it and sets it to null.
- In `run()`, right before the Task 11 block:
  ```ts
      // ── step 4: P0b heal in O (skin-cleanup spec §4.5); base0 of P0c / P0d is its output ──
      if (job.tone && job.tone.spots.length > 0) {
        heal ??= createHealPass(gl);
        const a = full('A', baseFb, job.srcSize);
        const ring = fb('RING', { width: HEAL_RING_SAMPLES, height: job.tone.spots.length });
        heal.draw(job.src, a, ring, job.tone.spots, job.win, job.srcSize);
        base = a.tex;
        baseFb = a;
        passes.push('heal');
      }
  ```
- `buildToneField` is called with `base` after this block, so the tone field is built from the healed image (the key already includes the spots).

- [ ] **Step 4: Run the tests**

Run: `npm run typecheck && npm run build && npx playwright test tests/e2e/tone-engine.spec.ts tests/e2e/engine.spec.ts tests/e2e/parity.spec.ts`
Expected: all pass; the log prints `heal GPU vs CPU max ≤ 2` and the planned spots (each with a non-zero donor except the border one).

- [ ] **Step 5: Commit**

```bash
git add src/engine/passes/heal.ts src/engine/pipeline.ts tests/e2e/pages/tone.ts tests/e2e/tone-engine.spec.ts
git commit -m "v0.4 step 4 (14/20): heal pass P0b on the GPU" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: The tap rule of zoomPan and its 祛痘 tap mode

**Files:**
- Modify: `src/ui/screens/zoomPan.ts` (CRLF; `ZoomPanOptions` `:33-41`, the `useZoomPan` effect `:54-140`, its tap bookkeeping `:61-63` and `up` handler `:109-127`, the listeners `:129-139`)
- Test: `src/ui/screens/zoomPan.test.ts` (new)

**Interfaces:**
- Consumes: step 1's `useZoomPan(stageRef, layerRef, enabled, opts: ZoomPanOptions = {})` with `ZoomPanOptions { onTap?(uv: [number, number], layer: DOMRect): void; resetWhen?: boolean }` (`zoomPan.ts:33-48`) — the tap uv taken from the transformed `.zoom-layer` rect and handed over with that rect, `onTap` called on `pointerup` only (never on `pointercancel`), read through `optsRef`, `--zs` written by `apply` (step-1 spec §2.1, §2.3); step 3's `resetWhen` (step-3 plan Task 13), kept as it is.
- Produces:
  ```ts
  export const TAP_SLOP_PX = 8;
  export interface GestureEvent { type: 'down' | 'move' | 'up' | 'cancel'; id: number; x: number; y: number; t: number }
  export interface TapResult { tap: { x: number; y: number; t: number } | null; fit: boolean }
  export function tapOutcome(events: readonly GestureEvent[], lastTapT: number, mode: 'view' | 'spot'): TapResult;
  // ZoomPanOptions (step 1 / 3) gains: spotTap?(uv: [number, number], layer: DOMRect): void
  ```
  With `spotTap` set (祛痘 mode, S §2.3): a one-finger tap that moved ≤ 8 px fires `spotTap(uv, layer)` on pointer-up, never on `pointercancel`, never waits for a double tap, and double-tap-to-fit is off; `onTap` is not called. Pinch and one-finger pan while zoomed work as before.

- [ ] **Step 1: Write the failing test**

Create `src/ui/screens/zoomPan.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { clampView, tapOutcome, type GestureEvent } from './zoomPan';

const ev = (type: GestureEvent['type'], x: number, y: number, t: number, id = 1): GestureEvent => ({ type, id, x, y, t });

describe('tapOutcome (skin-cleanup spec §2.3)', () => {
  it('one finger that stays within 8 px taps, on its up', () => {
    expect(tapOutcome([ev('down', 100, 100, 0), ev('move', 104, 103, 40), ev('up', 105, 104, 80)], -Infinity, 'spot')).toEqual({ tap: { x: 105, y: 104, t: 80 }, fit: false });
  });

  it('a move over 8 px or a second finger is no tap', () => {
    expect(tapOutcome([ev('down', 100, 100, 0), ev('move', 109, 100, 40), ev('up', 100, 100, 80)], -Infinity, 'spot').tap).toBeNull();
    expect(tapOutcome([ev('down', 100, 100, 0), ev('down', 200, 100, 20, 2), ev('up', 200, 100, 60, 2), ev('up', 100, 100, 80)], -Infinity, 'spot').tap).toBeNull();
  });

  it('a pointercancel never adds a spot; in view mode it still ends the gesture like an up (v0.3)', () => {
    expect(tapOutcome([ev('down', 100, 100, 0), ev('cancel', 100, 100, 50)], -Infinity, 'spot')).toEqual({ tap: null, fit: false });
    expect(tapOutcome([ev('down', 100, 100, 0), ev('cancel', 100, 100, 50)], -Infinity, 'view').tap).not.toBeNull();
  });

  it('view mode: a second tap within 300 ms also fits the view', () => {
    expect(tapOutcome([ev('down', 100, 100, 1000), ev('up', 100, 100, 1050)], 800, 'view').fit).toBe(true);
    expect(tapOutcome([ev('down', 100, 100, 1000), ev('up', 100, 100, 1050)], 600, 'view').fit).toBe(false);
  });

  it('spot mode: a quick double tap is two taps and never a fit (Review Focus 2)', () => {
    const a = tapOutcome([ev('down', 100, 100, 0), ev('up', 100, 100, 40)], -Infinity, 'spot');
    const b = tapOutcome([ev('down', 102, 101, 100), ev('up', 102, 101, 140)], a.tap!.t, 'spot');
    expect([a.tap !== null, a.fit, b.tap !== null, b.fit]).toEqual([true, false, true, false]);
  });

  it('clampView is unchanged', () => {
    expect(clampView({ s: 0.5, x: 9, y: 9 }, 100, 100)).toEqual({ s: 1, x: 0, y: 0 });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/ui/screens/zoomPan.test.ts`
Expected: FAIL — `tapOutcome is not a function`.

- [ ] **Step 3: Implement**

In `src/ui/screens/zoomPan.ts` (CRLF), below `pinchView` (line 31), add:
```ts
export const TAP_SLOP_PX = 8;

/** one pointer event of a gesture, for the pure tap rule */
export interface GestureEvent {
  type: 'down' | 'move' | 'up' | 'cancel';
  id: number;
  x: number;
  y: number;
  t: number;
}
export interface TapResult {
  tap: { x: number; y: number; t: number } | null;
  fit: boolean;
}

/**
 * The tap rule of one gesture, from its first pointer down to its last pointer up or cancel. One pointer that never moved
 * more than 8 px is a tap, reported at its up. 'view': a cancel ends the gesture like an up for the double tap (as before;
 * the hook still calls onTap on a pointerup only), and a tap within DOUBLE_TAP_MS of `lastTapT` also fits the view (step 1
 * fires onTap on both taps). 'spot' (祛痘, skin-cleanup spec §2.3): a gesture that ends in a cancel never taps, and nothing fits.
 */
export function tapOutcome(events: readonly GestureEvent[], lastTapT: number, mode: 'view' | 'spot'): TapResult {
  const none: TapResult = { tap: null, fit: false };
  const first = events[0];
  const last = events[events.length - 1];
  if (!first || first.type !== 'down' || !last || (last.type !== 'up' && last.type !== 'cancel')) return none;
  if (events.some((e) => e.id !== first.id)) return none;
  if (events.some((e) => Math.hypot(e.x - first.x, e.y - first.y) > TAP_SLOP_PX)) return none;
  const tap = { x: last.x, y: last.y, t: last.t };
  if (mode === 'spot') return last.type === 'cancel' ? none : { tap, fit: false };
  return { tap, fit: last.t - lastTapT < DOUBLE_TAP_MS };
}
```
In step 1's `ZoomPanOptions` (`zoomPan.ts:33-41`: `onTap(uv, layer)` and step 3's `resetWhen`, kept as they are) add
```ts
  /** step 4 (祛痘): a tap adds a spot — on pointer-up, never on pointercancel, double-tap-to-fit off; onTap is skipped */
  spotTap?(uv: [number, number], layer: DOMRect): void;
```
Then, inside `useZoomPan`'s effect (step 1 already reads `opts` through `optsRef`, `zoomPan.ts:50-52`, and the effect depends on `[enabled]` only), replace the tap bookkeeping — `let lastTap = 0; let moved = false; let downAt = …` (`zoomPan.ts:61-63`) — and the `down` / `move` / `up` handlers (`zoomPan.ts:97-127`) with gesture recording and the pure rule:
```ts
    let lastTap = -Infinity;
    let gesture: GestureEvent[] = [];
    const record = (type: GestureEvent['type'], e: PointerEvent) => gesture.push({ type, id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() });

    const down = (e: PointerEvent) => {
      if ((e.target as Element).closest('button, .slider-row, .status')) return;
      stage.setPointerCapture(e.pointerId);
      if (pts.size === 0) gesture = [];
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      record('down', e);
      begin();
    };
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      record('move', e);
      if (pts.size >= 2) {
        const t = twoPoint();
        apply(pinchView(start, m0, t.mid, t.dist / d0));
      } else if (start.s > 1) {
        const p = rel([...pts.values()][0]);
        apply({ s: start.s, x: start.x + p.x - m0.x, y: start.y + p.y - m0.y });
      }
    };
    const end = (e: PointerEvent) => {
      if (!pts.delete(e.pointerId)) return;
      record(e.type === 'pointercancel' ? 'cancel' : 'up', e);
      if (pts.size === 0) {
        const o = optsRef.current;
        const r = tapOutcome(gesture, lastTap, o.spotTap ? 'spot' : 'view');
        gesture = [];
        if (r.tap) {
          const rect = layer.getBoundingClientRect();
          const sized = rect.width > 0 && rect.height > 0;
          const uv: [number, number] = [(r.tap.x - rect.left) / rect.width, (r.tap.y - rect.top) / rect.height];
          if (o.spotTap) {
            if (sized) o.spotTap(uv, rect);
          } else {
            // a pointercancel (the browser took the gesture over) is no tap, but it still ends a double tap (step 1)
            if (sized && e.type === 'pointerup') o.onTap?.(uv, rect);
            if (r.fit) {
              lastTap = -Infinity;
              apply({ s: 1, x: 0, y: 0 }, true);
            } else lastTap = r.tap.t;
          }
        }
      }
      begin();
    };
```
Register `end` for both `pointerup` and `pointercancel`, in place of `up` (`zoomPan.ts:129-139`, the removals too). Keep everything else step 1 and step 3 put in the hook (`--zs` in `apply`, `optsRef`, the `[enabled]` dependency, the `resetWhen` effect).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/ui/screens/zoomPan.test.ts && npm run typecheck`
Expected: PASS.
Run: `npm run build && npx playwright test tests/e2e/editor.spec.ts tests/e2e/persons.spec.ts`
Expected: pass — double-tap-to-fit, pinch, pan and the person taps behave as before.

- [ ] **Step 5: Commit**

```bash
git add src/ui/screens/zoomPan.ts src/ui/screens/zoomPan.test.ts
git commit -m "v0.4 step 4 (15/20): pure tap rule in zoomPan, 祛痘 tap mode" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: The six tone sliders in the 美膚 strip

**Files:**
- Modify: `src/ui/panelModel.ts` (CRLF; types and helpers; wiring in `itemsFor` 'skin' `:590-608`, `sliderFor` 'skin' `:819-824`, `SliderView` `:748-766`)
- Modify: `src/ui/components/Slider.tsx` (CRLF; `aria-valuetext` `:190`, the `.slider-track` element `:208-215`), `src/ui/components/BeautyPanel.tsx` (CRLF; `Props` `:34-63`, the `itemsFor` call `:87`, the strip note `:97`), `src/ui/icons.tsx` (CRLF; six icons, after `eyeDistance`, `:96-101`), `src/ui/theme.css` (CRLF; `.slider-ends`, after the `.slider-track` rules, `:741-757`)
- Modify: `src/ui/screens/Editor.tsx` (the skin context, above `const binding = sliderFor(lens, sel, bodyCtx);` `:1408`; the `BeautyPanel` element `:1617-1628`)
- Test: `src/ui/panelModel.test.ts`, `src/ui/components/Slider.test.tsx` (step 1's file), `tests/e2e/tone.spec.ts` (new)

**Interfaces:**
- Consumes: Task 1 defs, Task 3 lens gate and `TONE_COPY`, Task 4 `mouthOpen`, `earOf`; step 1's `Lens` (`get`, `applies`), `lensFor`, the ported panel functions `itemsFor(lens, sel, body?)`, `sliderFor(lens, sel, body?)`, `tabHasValue(lens, tab, body?)` and `BeautyPanel` props `{lens, sel, onSel, onEdit, collapsed?, faceNote?, body?, photoTouched?, lookFailed?, onRetryLook?, crop?, id?}` (step-1 plan Task 10, steps 2–3), `BodyNote` (`panelModel.ts:121-127`), `bodyNoteFor` (`:188-204`), `itemDot` (`:358-363`), `gated` / `ENABLED` (`:371-373`, `:331`), `usable` / `photoLike` / `decorate` (`:223-226`, `:797-801`); step 2's `PanelItem.divider?: 'before'` and its `strip-divider` rendering in `BeautyPanel`; step 1's e2e helpers `selectPerson(page, n)` (`n = 0` is 全部, `tests/e2e/fixtures.ts:252-255`) and `__meiyan.boxes` (V-normalized after step 3).
- Produces (`src/ui/panelModel.ts`):
  ```ts
  export type FaceAnswer = 'faces' | 'noFace' | 'basic' | 'recovering' | 'paused' | 'failed';
  export interface SkinPanelContext { answer: FaceAnswer; mouthClosed: boolean; eyesClosed: boolean }  // Task 17 adds `spots`
  export function faceAnswer(i: { hasFaces: boolean; basic: boolean; unsure: boolean; tracker: 'ok' | 'lost' | 'failed' }): FaceAnswer;
  export function skinToolGate(item: ParamId | 'spot', skin: SkinPanelContext): RegionStatus;
  export function isToneId(id: string): id is ParamId;
  export function toneGate(lens: Lens, id: ParamId, skin: SkinPanelContext): RegionStatus;
  export function toneItems(lens: Lens, sel: PanelSelection, skin: SkinPanelContext): PanelItem[];
  export function toneHasValue(lens: Lens): boolean;
  export function skinNote(lens: Lens, sel: PanelSelection, skin: SkinPanelContext | undefined): BodyNote | null;
  export const WARM_ENDS: readonly [string, string];      // ['冷', '暖']
  // SliderView (and so SliderBinding, which extends it) gains: ends?: readonly [string, string];
  // itemsFor / sliderFor gain a 4th optional parameter skin?: SkinPanelContext (the editor passes it; the camera never does);
  // tabHasValue gains it in Task 17, where it is first read (noUnusedParameters)
  // BeautyPanel Props gain skin?: SkinPanelContext
  // src/ui/components/Slider.tsx
  export function valueText(text: string, n: number, ends?: readonly [string, string]): string;
  ```

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/panelModel.test.ts` (add to its imports whichever of these it does not have yet: `lensFor` from `../edit/lens`; `defaultPhoto`, `neutralPerson` from `../edit/state`; `TONE_COPY` from `../edit/toneCopy`; from `./panelModel`: `faceAnswer`, `INITIAL_SELECTION`, `skinNote`, `skinToolGate`, `toneHasValue`, `toneItems`, `WARM_ENDS`, `type SkinPanelContext`):
```ts
describe('step 4: 膚質 items (skin-cleanup spec §2.1, §2.2, §3.6)', () => {
  const persons = [
    { id: 'f0', face: true, body: false },
    { id: 'b0', face: false, body: true },
  ];
  const edit = (values: Record<string, number> = {}) => ({
    v: 2 as const,
    photo: { ...defaultPhoto(), spots: [] },
    persons: { f0: { ...neutralPerson(), values: { ...neutralPerson().values, ...values } }, b0: neutralPerson() },
    template: neutralPerson(),
    primaryInit: null,
  });
  const lens = (values: Record<string, number> = {}, who = 'f0') => lensFor(edit(values), { kind: 'person', id: who }, persons, 'f0');
  const skin = (answer: SkinPanelContext['answer'] = 'faces', extra: Partial<SkinPanelContext> = {}): SkinPanelContext => ({ answer, mouthClosed: false, eyesClosed: false, ...extra });
  const sel = (s: string) => ({ ...INITIAL_SELECTION, tab: 'skin' as const, skin: s as never });

  it('six tone items in strip order, 勻膚 opening the divider, each with its own icon', () => {
    const items = toneItems(lens(), sel('skin.smooth'), skin());
    expect(items.map((i) => i.label)).toEqual(['勻膚', '膚色', '黑眼圈', '法令紋', '白牙', '亮眼']);
    expect(items.map((i) => i.divider)).toEqual(['before', undefined, undefined, undefined, undefined, undefined]);
    for (const it of items) if (it.visual.kind === 'icon') expect(hasIcon(it.visual.icon), it.visual.icon).toBe(true);
    expect(items.every((i) => !i.disabled)).toBe(true);
  });

  it('the dot follows the selected person’s value; the tab dot lights for a tone value alone', () => {
    expect(toneItems(lens({ 'tone.warmth': 0.62 }), sel('skin.smooth'), skin()).find((i) => i.label === '膚色')!.hasValue).toBe(true);
    expect(toneHasValue(lens({ 'tone.teeth': 0.3 }))).toBe(true);
    expect(toneHasValue(lens())).toBe(false);
  });

  it('disables the six with the photo-level reasons; a face-less person gets the lens reason', () => {
    const reasons = (s: SkinPanelContext, who = 'f0') => [...new Set(toneItems(lens({}, who), sel('skin.smooth'), s).map((i) => i.reason))];
    expect(reasons(skin('noFace'))).toEqual([TONE_COPY.noFace]);
    expect(reasons(skin('basic'))).toEqual([TONE_COPY.basic]);
    expect(reasons(skin('recovering'))).toEqual([TONE_COPY.recovering]);
    expect(reasons(skin('paused'))).toEqual([TONE_COPY.paused]);
    expect(reasons(skin('failed'))).toEqual([TONE_COPY.failed]);
    expect(reasons(skin(), 'b0')).toEqual(['這位人物未偵測到臉部，臉部效果不適用']);
    expect(skinToolGate('spot', skin('noFace')).ok).toBe(true);
    expect(skinToolGate('spot', skin('basic')).ok).toBe(true);
    expect(skinToolGate('spot', skin('paused'))).toEqual({ ok: false, reason: TONE_COPY.paused });
  });

  it('notes: 白牙 on a closed mouth, 亮眼 on closed eyes, a disabled selection explains itself', () => {
    expect(skinNote(lens(), sel('tone.teeth'), skin('faces', { mouthClosed: true }))?.text).toBe(TONE_COPY.mouthClosed);
    expect(skinNote(lens(), sel('tone.eyeBright'), skin('faces', { eyesClosed: true }))?.text).toBe(TONE_COPY.eyesClosed);
    expect(skinNote(lens(), sel('tone.teeth'), skin())).toBeNull();
    expect(skinNote(lens(), sel('tone.even'), skin('basic'))?.text).toBe(TONE_COPY.basic);
    expect(skinNote(lens(), sel('skin.smooth'), skin('basic'))).toBeNull();
    expect(skinNote(lens(), sel('tone.even'), undefined)).toBeNull();
  });

  it('膚色 carries the end captions 冷 / 暖', () => {
    expect(WARM_ENDS).toEqual(['冷', '暖']);
  });

  it('faceAnswer follows the editor’s note order: faces, 基本模式, no face, then the tracker state', () => {
    const a = (hasFaces: boolean, basic: boolean, unsure: boolean, tracker: 'ok' | 'lost' | 'failed') => faceAnswer({ hasFaces, basic, unsure, tracker });
    expect(a(true, true, true, 'lost')).toBe('faces');
    expect(a(false, true, false, 'ok')).toBe('basic');
    expect(a(false, false, false, 'ok')).toBe('noFace');
    expect(a(false, false, true, 'lost')).toBe('recovering');
    expect(a(false, false, true, 'failed')).toBe('paused');
    expect(a(false, false, true, 'ok')).toBe('failed');
  });
});
```
Append to step 1's `src/ui/components/Slider.test.tsx` (LF; add `valueText` to its `import { SliderRow } from './Slider';`, and `describe` / `expect` / `it` are already imported from `vitest`):
```ts
describe('valueText (膚色 ends, skin-cleanup spec §2.2)', () => {
  it('names the end the value leans to', () => {
    expect(valueText('−20', -20, ['冷', '暖'])).toBe('−20 冷');
    expect(valueText('+15', 15, ['冷', '暖'])).toBe('+15 暖');
    expect(valueText('0', 0, ['冷', '暖'])).toBe('0');
    expect(valueText('35', 35)).toBe('35');
  });
});
```
Create `tests/e2e/tone.spec.ts`:
```ts
// 膚質 tools in the app (skin-cleanup spec §8.4), production build. Pixel checks read the canvas through screenshots
// (grab / mad, fixtures.ts:91, 104); exact pixel values are the engine harness's job (tone-engine.spec.ts). O positions
// come from tests/fixtures/sample_face_tone.json and map to the screen through the frame's fitted rectangle (no zoom).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { debugState, dragSlider, expect, mad, selectPerson, settled, test, type Pixels, type Rect } from './fixtures';

const TONE_PNG = resolve(import.meta.dirname, '../fixtures/sample_face_tone.png');
const GROUP_PNG = resolve(import.meta.dirname, '../fixtures/group_faces.png');
interface Defect {
  kind: string;
  name: string;
  center: [number, number];
  sigma?: number;
  box: [number, number, number, number];
}
interface Fixture {
  width: number;
  height: number;
  fw: number;
  defects: Defect[];
}
/** read lazily: global-setup generates the file after the specs are collected */
const fixture = (): Fixture => JSON.parse(readFileSync(resolve(import.meta.dirname, '../fixtures/sample_face_tone.json'), 'utf8')) as Fixture;
// (Task 17 adds `defect(fx, name)` with its first user: an unused top-level const fails `noUnusedLocals`)

async function importPhoto(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }): Promise<void> {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /匯入照片/ }).click();
  await (await chooser).setFiles(file);
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 90_000 });
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 10_000 });
}
const option = (page: Page, name: string): Locator => page.getByRole('option', { name, exact: true });
async function pick(page: Page, tab: string, name: string): Promise<void> {
  await page.getByRole('tab', { name: tab }).click();
  await option(page, name).click();
  await expect(option(page, name)).toHaveAttribute('aria-selected', 'true');
  await page.waitForTimeout(250);
}
const frame = (page: Page) => page.locator('.editor-stage .frame');
/** 一鍵 › 原圖 on the current selection: no 美白, 磨皮 or warp in the way of the comparisons */
async function plain(page: Page): Promise<void> {
  await page.getByRole('tab', { name: '一鍵' }).click();
  await option(page, '原圖').click();
  await settled(frame(page));
}
/** an O-pixel rect (photo of W × H) in screenshot pixels */
const shotRect = (p: Pixels, r: Rect, W: number, H: number): Rect => ({
  x: Math.round((r.x / W) * p.width),
  y: Math.round((r.y / H) * p.height),
  w: Math.max(1, Math.round((r.w / W) * p.width)),
  h: Math.max(1, Math.round((r.h / H) * p.height)),
});
/** the union of a defect kind's boxes, padded by 6 px */
function boxOf(fx: Fixture, kinds: string[]): Rect {
  const ds = fx.defects.filter((d) => kinds.includes(d.kind));
  const x0 = Math.min(...ds.map((d) => d.box[0])) - 6;
  const y0 = Math.min(...ds.map((d) => d.box[1])) - 6;
  const x1 = Math.max(...ds.map((d) => d.box[2])) + 6;
  const y1 = Math.max(...ds.map((d) => d.box[3])) + 6;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

test('each 膚質 slider changes its own face area and leaves the background alone', async ({ page }) => {
  const fx = fixture();
  await importPhoto(page, TONE_PNG);
  await plain(page);
  const base = await settled(frame(page));
  const background: Rect = { x: 20, y: 40, w: 54, h: 54 }; // grey wall left of the hair
  const areas: Record<string, Rect> = {
    勻膚: boxOf(fx, ['blotch']),
    膚色: boxOf(fx, ['blotch', 'blemish', 'darkCircle', 'fold']),
    黑眼圈: boxOf(fx, ['darkCircle']),
    法令紋: boxOf(fx, ['fold']),
    白牙: boxOf(fx, ['teeth']),
    亮眼: boxOf(fx, ['sclera']),
  };
  for (const [label, rect] of Object.entries(areas)) {
    await pick(page, '美膚', label);
    await dragSlider(page, 400);
    const after = await settled(frame(page));
    const inside = mad(after, base, shotRect(after, rect, fx.width, fx.height));
    const outside = mad(after, base, shotRect(after, background, fx.width, fx.height));
    console.log(`${label}: inside ${inside.toFixed(2)}, background ${outside.toFixed(3)}`);
    expect(inside, label).toBeGreaterThan(0.5);
    expect(outside, label).toBeLessThanOrEqual(0.2);
    if (label === '膚色') await expect(page.getByRole('slider')).toHaveAttribute('aria-valuetext', '+50 暖');
    await page.getByRole('button', { name: '復原' }).click();
    await settled(frame(page));
  }
});

test('a 瘦臉 drag reuses the tone field; a 勻膚 drag rebuilds it', async ({ page }) => {
  await importPhoto(page, TONE_PNG);
  await pick(page, '美膚', '勻膚');
  await dragSlider(page, 120);
  await settled(frame(page));
  const before = (await debugState(page)).toneBuilds;
  await pick(page, '美型', '瘦臉');
  await dragSlider(page, 200);
  await settled(frame(page));
  expect((await debugState(page)).toneBuilds).toBe(before);
  await pick(page, '美膚', '勻膚');
  await dragSlider(page, 60);
  await settled(frame(page));
  expect((await debugState(page)).toneBuilds).toBeGreaterThan(before);
});

test('per person: 膚色 on person 2 changes only face 2; under 全部 every face', async ({ page }) => {
  await importPhoto(page, GROUP_PNG);
  await selectPerson(page, 0);
  await plain(page);
  const boxes = (await debugState(page)).boxes;
  expect(boxes.length).toBe(3);
  await selectPerson(page, 2);
  const base = await settled(frame(page));
  const inShot = (p: Pixels, b: { x: number; y: number; w: number; h: number }): Rect => ({
    x: Math.round(b.x * p.width),
    y: Math.round(b.y * p.height),
    w: Math.round(b.w * p.width),
    h: Math.round(b.h * p.height),
  });
  await pick(page, '美膚', '膚色');
  await dragSlider(page, 400);
  const one = await settled(frame(page));
  expect(mad(one, base, inShot(one, boxes[1]))).toBeGreaterThan(0.3);
  expect(mad(one, base, inShot(one, boxes[0]))).toBeLessThanOrEqual(0.1);
  expect(mad(one, base, inShot(one, boxes[2]))).toBeLessThanOrEqual(0.1);
  await selectPerson(page, 0);
  await dragSlider(page, 400);
  const all = await settled(frame(page));
  for (const b of boxes) expect(mad(all, base, inShot(all, b))).toBeGreaterThan(0.3);
});

/** 600 × 800 skin-tone noise with one dark dot at (300, 400): no face for the detector */
function noFaceDotPng(): Buffer {
  const png = new PNG({ width: 600, height: 800 });
  for (let y = 0; y < 800; y++)
    for (let x = 0; x < 600; x++) {
      const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      const v = 0.72 + 0.04 * (n - Math.floor(n) - 0.5);
      const g = Math.exp(-((x - 300) ** 2 + (y - 400) ** 2) / 50);
      const k = 1 - 0.3 * g;
      const i = (y * 600 + x) * 4;
      png.data[i] = Math.round(255 * Math.min(1, v * 1.12) * k);
      png.data[i + 1] = Math.round(255 * v * 0.88 * k);
      png.data[i + 2] = Math.round(255 * v * 0.76 * k);
      png.data[i + 3] = 255;
    }
  return PNG.sync.write(png);
}

test('a photo without a face disables the six sliders with the reason', async ({ page }) => {
  await importPhoto(page, { name: 'noface.png', mimeType: 'image/png', buffer: noFaceDotPng() });
  await page.getByRole('tab', { name: '美膚' }).click();
  for (const label of ['勻膚', '膚色', '黑眼圈', '法令紋', '白牙', '亮眼']) await expect(option(page, label)).toHaveAttribute('aria-disabled', 'true');
  await option(page, '勻膚').click();
  await expect(page.getByText('未偵測到臉部，膚質工具不會套用').first()).toBeVisible();
});

test('the camera offers none of the 膚質 tools', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /拍攝/ }).click();
  await page.getByRole('button', { name: '點擊開啟相機' }).click();
  await expect.poll(async () => (await debugState(page)).cameraState, { timeout: 90_000 }).toBe('live');
  await page.getByRole('tab', { name: '美膚' }).click();
  await expect(option(page, '磨皮')).toBeVisible();
  for (const label of ['勻膚', '膚色', '黑眼圈', '法令紋', '白牙', '亮眼', '祛痘']) await expect(option(page, label)).toHaveCount(0);
  await expect(page.locator('.strip .strip-divider')).toHaveCount(0);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/ui/panelModel.test.ts src/ui/components/Slider.test.tsx`
Expected: FAIL — `toneItems is not a function`, `valueText is not a function`.

- [ ] **Step 3: Implement**

`src/ui/panelModel.ts` — add (imports: `TONE_COPY` from `../edit/toneCopy`; `type Lens` (`panelModel.ts:4`), `paramDef`, `paramsInGroup`, `hasValue` (`:2`) and `RegionStatus` (`:7`) are already imported):
```ts
// ───────────── 膚質 (skin-cleanup spec §2.1–2.4, §3.6) ─────────────

/** the photo's face answer, in the order of the editor's notes (Editor.tsx:1470-1479) */
export type FaceAnswer = 'faces' | 'noFace' | 'basic' | 'recovering' | 'paused' | 'failed';
export interface SkinPanelContext {
  answer: FaceAnswer;
  /** 白牙: every target face's mouth is closed (mouthOpen < 0.01) */
  mouthClosed: boolean;
  /** 亮眼: every target face has both eyes closed (EAR < 0.12) */
  eyesClosed: boolean;
}
export const WARM_ENDS = TONE_COPY.warmEnds;

export function faceAnswer(i: { hasFaces: boolean; basic: boolean; unsure: boolean; tracker: 'ok' | 'lost' | 'failed' }): FaceAnswer {
  if (i.hasFaces) return 'faces';
  if (i.basic) return 'basic';
  if (!i.unsure) return 'noFace';
  return i.tracker === 'lost' ? 'recovering' : i.tracker === 'failed' ? 'paused' : 'failed';
}

const SKIN_OK: RegionStatus = { ok: true, reason: null };
/**
 * The photo-level gate of the seven tools: while the face answer is only temporarily unknown all seven are off (a tap
 * could heal an eye the refusal rule cannot see yet); without a face or in 基本模式 the six sliders are off, 祛痘 works.
 */
export function skinToolGate(item: ParamId | 'spot', skin: SkinPanelContext): RegionStatus {
  switch (skin.answer) {
    case 'faces':
      return SKIN_OK;
    case 'recovering':
      return { ok: false, reason: TONE_COPY.recovering };
    case 'paused':
      return { ok: false, reason: TONE_COPY.paused };
    case 'failed':
      return { ok: false, reason: TONE_COPY.failed };
    case 'basic':
      return item === 'spot' ? SKIN_OK : { ok: false, reason: TONE_COPY.basic };
    case 'noFace':
      return item === 'spot' ? SKIN_OK : { ok: false, reason: TONE_COPY.noFace };
  }
}

export function isToneId(id: string): id is ParamId {
  return id.startsWith('tone.');
}

/** the photo-level gate, then the lens (the selected person needs a face; under 全部, any face person) */
export function toneGate(lens: Lens, id: ParamId, skin: SkinPanelContext): RegionStatus {
  const g = skinToolGate(id, skin);
  if (!g.ok) return g;
  const a = lens.applies(id);
  return a.ok ? SKIN_OK : { ok: false, reason: a.reason ?? TONE_COPY.noFace };
}

/** 勻膚 · 膚色 · 黑眼圈 · 法令紋 · 白牙 · 亮眼, after the 美膚 group, 勻膚 opening step 2's divider */
export function toneItems(lens: Lens, sel: PanelSelection, skin: SkinPanelContext): PanelItem[] {
  return paramsInGroup('tone').map((d, i) =>
    gated(
      {
        key: d.id,
        label: d.label,
        visual: { kind: 'icon', icon: d.icon },
        selected: sel.skin === d.id,
        // step 1's item dot: the selected person's value, under 全部 any applicable person's (S1 §2.4 Dots)
        hasValue: itemDot(lens, d),
        action: { type: 'param', id: d.id },
        ...ENABLED,
        ...(i === 0 ? { divider: 'before' as const } : {}),
      },
      toneGate(lens, d.id, skin),
    ),
  );
}

export function toneHasValue(lens: Lens): boolean {
  return paramsInGroup('tone').some((d) => hasValue(d, lens.get(d.id).value));
}

/** the 美膚 strip note while a tone item is selected: why it is off, or the closed-mouth / closed-eye hint */
export function skinNote(lens: Lens, sel: PanelSelection, skin: SkinPanelContext | undefined): BodyNote | null {
  if (sel.tab !== 'skin' || !skin || !isToneId(sel.skin)) return null;
  const g = toneGate(lens, sel.skin, skin);
  if (!g.ok) return { text: g.reason ?? TONE_COPY.noFace, tone: 'info' };
  if (sel.skin === 'tone.teeth' && skin.mouthClosed) return { text: TONE_COPY.mouthClosed, tone: 'info' };
  if (sel.skin === 'tone.eyeBright' && skin.eyesClosed) return { text: TONE_COPY.eyesClosed, tone: 'info' };
  return null;
}
```
Wiring — step 1 ported the panel functions to `itemsFor(lens, sel, body?: BodyContext)`, `sliderFor(lens, sel, body?)`, `tabHasValue(lens, tab, body?)` (step-1 plan Task 10; the camera passes `cameraBody`, so `body` cannot tell the editor from the camera). `itemsFor` and `sliderFor` gain a **fourth optional parameter `skin?: SkinPanelContext`**, which only the editor passes (`tabHasValue` gains it in Task 17, its first reader; `noUnusedParameters` rejects an unread one):
- `SliderView` (`panelModel.ts:748-766`; `SliderBinding` extends it, and `SliderRow` takes a `SliderView`) gains `/** captions under the two track ends (膚色: 冷 / 暖) */ ends?: readonly [string, string];`
- `itemsFor(lens: Lens, sel: PanelSelection, body?: BodyContext, skin?: SkinPanelContext)`: the shared `case 'skin': case 'shape':` (`panelModel.ts:590-608`) returns `[RESET_ITEM(), ...paramsInGroup(sel.tab).map(…)]`; append to that array `...(sel.tab === 'skin' && skin ? toneItems(lens, sel, skin) : [])` (the camera passes no `skin`, so it gets neither the tone items nor the divider).
- `sliderFor(lens: Lens, sel: PanelSelection, body?: BodyContext, skin?: SkinPanelContext)`: step 1's shared case (`panelModel.ts:819-824`) is
  `case 'skin': case 'shape': { const id = sel[sel.tab]; if (!usable(lens, id)) return null; return decorate(paramBinding(lens, id), lens, photoLike(lens, id)); }` — replace it with
  ```ts
      case 'skin':
      case 'shape': {
        const id = sel[sel.tab];
        if (sel.tab === 'skin' && isToneId(id) && !(skin && toneGate(lens, id, skin).ok)) return null;
        if (!usable(lens, id)) return null;
        const b = decorate(paramBinding(lens, id), lens, photoLike(lens, id));
        return id === 'tone.warmth' ? { ...b, ends: WARM_ENDS } : b;
      }
  ```
- `tabHasValue`: unchanged in this task — its `'skin'` case's `lens.groupHasValue('skin')` already counts the tone items through Task 3.
- `BeautyPanel` (CRLF): `Props` (`BeautyPanel.tsx:34-63`) gains `/** 膚質 context; the editor passes it, the camera never does */ skin?: SkinPanelContext;`, the destructuring (`:68`) gains `skin`, and the `itemsFor` call (`:87`) becomes `itemsFor(lens, sel, body, skin)` (the `tabHasValue` call follows in Task 17). Add `skinNote` and `type SkinPanelContext` to its `../panelModel` import.

`src/ui/components/Slider.tsx`:
```ts
/** aria-valuetext: the value, plus the end it leans to when the slider has end captions (「−20 冷」, 「+15 暖」) */
export function valueText(text: string, n: number, ends?: readonly [string, string]): string {
  return ends && n !== 0 ? `${text} ${n < 0 ? ends[0] : ends[1]}` : text;
}
```
In `SliderRow`, step 1's `aria-valuetext` (`Slider.tsx:190`) appends 「，各人不同」 to `text` when `binding.mixed`; keep that and name the end too:
```tsx
        aria-valuetext={binding.mixed ? `${valueText(text, displayOf(bi, v, sc), binding.ends)}，各人不同` : valueText(text, displayOf(bi, v, sc), binding.ends)}
```
(`displayOf(bi, v, sc)` is step 3's form, with the slider scale.) After the `.slider-track` element (`Slider.tsx:208-215`), still inside `.slider`, add:
```tsx
        {binding.ends && (
          <div class="slider-ends" aria-hidden="true">
            <span>{binding.ends[0]}</span>
            <span>{binding.ends[1]}</span>
          </div>
        )}
```
`src/ui/theme.css` (CRLF — edit in place) after the `.slider-track` rules (`theme.css:741-757`, including step 2's `.track-temperature` / `.track-tint`):
```css
.slider-ends {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(50% + 9px);
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  line-height: 1;
  color: var(--text-2);
  pointer-events: none;
}
```
`src/ui/components/BeautyPanel.tsx:97` — the strip note (step 1: `const note = sel.tab === 'body' ? bodyNoteFor(body, lens, sel) : null;`) gains the 美膚 branch (`skin` is the new prop):
```ts
  const note = sel.tab === 'body' ? bodyNoteFor(body, lens, sel) : sel.tab === 'skin' ? skinNote(lens, sel, skin) : null;
```
(`StripBodyNote` renders it with the existing `body-note` style.)
`src/ui/icons.tsx` (CRLF) — after `eyeDistance` (`icons.tsx:96-101`; none of the seven names exists yet), original line icons on the 24 × 24 grid:
```tsx
  even: (
    <>
      <circle cx="12" cy="12" r="7.6" />
      <path d="M7 13.4c1.7-1.6 3.3-1.6 5 0s3.3 1.6 5 0" />
    </>
  ),
  tone: (
    <>
      <circle cx="12" cy="12" r="7.6" />
      <path d="M12 4.4v15.2" />
      <path d="M12 7.6a4.4 4.4 0 0 1 0 8.8" />
    </>
  ),
  darkCircle: (
    <>
      <path d="M3.8 10.2c2.4-3.2 5-4.6 8.2-4.6s5.8 1.4 8.2 4.6c-2.4 3.2-5 4.6-8.2 4.6s-5.8-1.4-8.2-4.6Z" />
      <circle cx="12" cy="10.2" r="2" />
      <path d="M7.2 17.8c3 1.6 6.6 1.6 9.6 0" />
    </>
  ),
  nasolabial: (
    <>
      <path d="M12 4.2v6.6c0 1.3-.9 2.2-2.2 2.2" />
      <path d="M8.2 13.8c-1.6 1.8-2 4-1.4 6" />
      <path d="M15.8 13.8c1.6 1.8 2 4 1.4 6" />
    </>
  ),
  teeth: (
    <>
      <path d="M4 9.6c2.6-1.8 5.2-2.6 8-2.6s5.4.8 8 2.6c-1.4 4.4-4.4 7-8 7s-6.6-2.6-8-7Z" />
      <path d="M4.8 10.4h14.4" />
      <path d="M9.6 10.4v3.2M14.4 10.4v3.2" />
    </>
  ),
  eyeBright: (
    <>
      <path d="M3.4 12c2.4-3.6 5.3-5.4 8.6-5.4s6.2 1.8 8.6 5.4c-2.4 3.6-5.3 5.4-8.6 5.4S5.8 15.6 3.4 12Z" />
      <circle cx="12" cy="12" r="2.4" />
      <path d="M18.8 3.4v3M17.3 4.9h3" />
    </>
  ),
```
`src/ui/screens/Editor.tsx` (LF) — right above `const binding = sliderFor(lens, sel, bodyCtx);` (`Editor.tsx:1408`; the face note it mirrors is built at `:1470-1479`), build the skin context and pass it to `sliderFor` and `BeautyPanel`:
```ts
  // 膚質 (skin-cleanup spec §1.2, §2.2): the photo's face answer; the closed-mouth / closed-eye notes of the target faces
  const personOfFace = new Map((detect?.persons ?? []).filter((p) => p.face).map((p) => [p.face as string, p.id]));
  const toneTargets = (session?.faces ?? []).filter((f) => selected.kind === 'all' || personOfFace.get(f.id) === selected.id).map((f) => f.face);
  const skinCtx: SkinPanelContext = {
    // no answer yet while analysing (session null): no disabled flash, as the face note above (the slider row and the
    // canvas input are off until the session exists anyway)
    answer: session ? faceAnswer({ hasFaces: session.faces.length > 0, basic: !!bundle?.basic, unsure: !!bound?.unsure, tracker: trackerHealth }) : 'faces',
    mouthClosed: toneTargets.length > 0 && toneTargets.every((f) => mouthOpen(f, bodyAspect) < 0.01),
    eyesClosed: toneTargets.length > 0 && toneTargets.every((f) => earOf(f, 'L', bodyAspect) < 0.12 && earOf(f, 'R', bodyAspect) < 0.12),
  };
```
(`detect` = step 1's detection-cache state of the Editor (`Editor.tsx:134`), `selected` = its resolved per-photo `Selection` (`:151`), `session.faces` = step 1's `SessionFace[]` (O-space, `id` = the cache face id), `bundle` / `bound` / `trackerHealth` as the face note uses them (`:128`, `:188`, `:127`); `bodyAspect` is the photo aspect, `Editor.tsx:266`. Imports: add `faceAnswer`, `type SkinPanelContext` to the `../panelModel` import (`:90-103`); `earOf`, `mouthOpen` from `../../engine/passes/toneGeometry`.) Then the binding line becomes `const binding = sliderFor(lens, sel, bodyCtx, skinCtx);`, and `<BeautyPanel … body={bodyCtx} …/>` (`:1617-1628`) gains `skin={skinCtx}`. `Camera.tsx` is not touched.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/ui && npm run typecheck`
Expected: PASS (step 1's 美膚 strip test still sees the first five items unchanged; if it asserts the whole strip with an editor context, extend its expected list with the six tone labels).
Run: `npm run build && npx playwright test tests/e2e/tone.spec.ts tests/e2e/camera.spec.ts tests/e2e/editor.spec.ts`
Expected: all pass; the log prints each tool's `inside … background …` pair.

- [ ] **Step 5: Commit**

```bash
git add src/ui/panelModel.ts src/ui/panelModel.test.ts src/ui/components/Slider.tsx src/ui/components/Slider.test.tsx src/ui/components/BeautyPanel.tsx src/ui/icons.tsx src/ui/theme.css src/ui/screens/Editor.tsx tests/e2e/tone.spec.ts
git commit -m "v0.4 step 4 (16/20): six 膚質 sliders in the 美膚 strip" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: 祛痘 mode in the editor

**Files:**
- Modify: `src/ui/panelModel.ts` (CRLF; `SkinSel`, `PanelSelection.skin` `:40-50`, `photoScoped` `:211-219`, `ItemAction` `:295-309`, `activate` `:670-735`, `sliderFor`, `tabHasValue` `:897-916`; new helpers)
- Modify: `src/ui/components/BeautyPanel.tsx` (CRLF; the `tabHasValue` call `:224`)
- Create: `src/ui/components/SpotControls.tsx`, `src/ui/components/SpotOverlay.tsx`, `src/engine/backMapFrame.ts`
- Modify: `src/ui/screens/Editor.tsx` (LF; `lastSel` `:121`, `setSel` `:419-424`, the `useZoomPan` call `:1415-1427`, `showBoxes` `:1469`, the stage `:1525-1605` and the panel `:1607-1629`), `src/ui/icons.tsx` (`spot`), `src/ui/theme.css` (spot styles)
- Test: `src/ui/panelModel.test.ts`, `src/engine/backMapFrame.test.ts`, `tests/e2e/tone.spec.ts`

**Interfaces:**
- Consumes: Tasks 2, 13 (`addSpot`, `clearSpots`, `clearScope`, `spotsInScope`, `spotRadius`, `regionAt`, `ownerAt`, `ownerCtxOf`, `planSpot`, `patchPlan`, `readPatch`), Task 15 (`spotTap`), Task 16 (`SkinPanelContext`, `skinToolGate`); `SPOT_CAP`, `TONE_COPY`; step 3's `backMapCpu(v: Vec2, frame: BackMapFrame)` with `BackMapFrame { geometry: Geometry; oSize: Size; oMap: UvMap }` (`src/engine/backMapCpu.ts:9-20`; it applies Geo⁻¹ and then `oMap`) and `viewSize(geometry, oPx)`; step 1's `tableFaces(job: Pick<FrameJob, 'faces' | 'obstacles'>, aspect)`, `FrameFace` (`src/engine/pipeline.ts:60-77`, `:207-221`), `reshapeMapMulti(faces, aspect, { body, protects })` (`reshapeCpu.ts:111`), `boxCentre`, `ovalBox` (`faceCap.ts`), `makeupUniformsFor`, `reshapeUniforms`, `MAX_RENDER_FACES`, `RenderFace { face; weight; person; protect; presence?; warpScale? }` (`types.ts:449-464`; `index.ts` scales each face's warp uniforms by `warpScale`, its private `scaleUniforms`, `index.ts:56-62`), the editor's `frameOf(e, s)` (`Editor.tsx:366-369`: `buildFrame` with the faces, obstacles, limits, primary and the λ_f `warpScales`); step 1's `Selection` (the Editor's resolved `selected`), the person strip / face boxes and their visibility condition (`showBoxes`); `Segmented` (`Controls.tsx:47-78`); `toast`, `haptic`, `debug` (already imported by the Editor).
- Produces (`src/ui/panelModel.ts`):
  ```ts
  export type SkinSel = ParamId | 'spot';                 // PanelSelection.skin: SkinSel
  // ItemAction gains { type: 'spot' }
  // SkinPanelContext gains spots: { inScope: number; total: number; onePerson: boolean }
  export function showsSpotMode(sel: PanelSelection): boolean;
  export function rememberable(sel: PanelSelection): PanelSelection;   // lastSel never keeps 'spot'
  export function spotItem(sel: PanelSelection, skin: SkinPanelContext): PanelItem;
  export const CLEAR_CONFIRM_MS = 3000;
  export function clearLabel(count: number, onePerson: boolean, confirming: boolean): string;
  export function clearTap(confirmUntil: number, now: number, count: number): { confirmUntil: number; clear: boolean };
  export function clearArmKey(scope: string, inScope: number, total: number): string;
  export function spotTapInside(uv: readonly [number, number]): boolean;
  export function spotsOnTab(skin: SkinPanelContext | undefined): boolean;
  // components
  export function SpotControls(props: { size: SpotSize; onSize(s: SpotSize): void; label: string; disabled: boolean; confirming: boolean; onClear(): void }): JSX.Element;
  export interface SpotRing { id: number; x: number; y: number; r: number }   // layer-normalized centre, radius / layer width
  export function SpotOverlay(props: { rings: readonly SpotRing[] }): JSX.Element;
  // src/engine/backMapFrame.ts
  export interface BackMapInput { faces: readonly RenderFace[]; obstacles?: readonly (readonly [number, number])[]; body?: BodyField | null; geometry: Geometry }
  export function backMapFrameOf(input: BackMapInput, oSize: Size): BackMapFrame;   // the oMap the engine's face table and 美體 field make
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/engine/backMapFrame.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultPhoto, neutralPerson } from '../edit/state';
import { apply, IDENTITY_GEOMETRY, vToO } from '../geometry/view';
import { adapt } from '../tracking/adapter111';
import { backMapCpu } from './backMapCpu';
import { backMapFrameOf } from './backMapFrame';
import { reshapeUniforms } from './passes/reshape';
import { reshapeMapCpu } from './passes/reshapeCpu';

const lm = JSON.parse(readFileSync(new URL('../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as {
  width: number;
  height: number;
  points: number[];
};
const FACE = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);
const O_SIZE = { width: lm.width, height: lm.height };

describe('backMapFrameOf: the editor tap back-map (skin-cleanup spec §3.4)', () => {
  it('no face and no body: only Geo⁻¹', () => {
    const g = defaultPhoto().geometry;
    const f = backMapFrameOf({ faces: [], geometry: g }, O_SIZE);
    expect(backMapCpu([0.3, 0.6], f)).toEqual(apply(vToO(g, O_SIZE), [0.3, 0.6]));
  });

  it('one face: the engine face chain, as the single-face CPU port computes it', () => {
    const person = neutralPerson();
    const values = { ...person.values, 'shape.faceSlim': 0.6, 'shape.eyeEnlarge': 0.5 };
    const f = backMapFrameOf({ faces: [{ face: FACE, weight: 1, person: { ...person, values }, protect: null }], geometry: IDENTITY_GEOMETRY }, O_SIZE);
    const ref = reshapeMapCpu(FACE, reshapeUniforms(values, 1), O_SIZE.width / O_SIZE.height);
    let moved = 0;
    for (let y = 0.2; y <= 0.8; y += 0.05)
      for (let x = 0.2; x <= 0.8; x += 0.05) {
        const a = backMapCpu([x, y], f);
        const b = ref(x, y);
        expect(a[0]).toBeCloseTo(b[0], 6);
        expect(a[1]).toBeCloseTo(b[1], 6);
        moved = Math.max(moved, Math.hypot(b[0] - x, b[1] - y));
      }
    expect(moved).toBeGreaterThan(1e-3);
  });
});
```
(`defaultPhoto().geometry` is step 3's identity geometry; `IDENTITY_GEOMETRY` is step 3's export of `src/geometry/view.ts`.)

Append to `src/ui/panelModel.test.ts` (add to its `./panelModel` import: `clearArmKey`, `clearLabel`, `clearTap`, `CLEAR_CONFIRM_MS`, `rememberable`, `showsSpotMode`, `spotItem`, `spotsOnTab`, `spotTapInside`, and `activate` / `tabHasValue` if they are not imported yet; `lensFor`, `defaultPhoto`, `neutralPerson` and `TONE_COPY` came in with Task 16):
```ts
describe('step 4: 祛痘 (skin-cleanup spec §2.3)', () => {
  const skin = (inScope = 0, total = 0, onePerson = false, answer: SkinPanelContext['answer'] = 'faces'): SkinPanelContext => ({
    answer,
    mouthClosed: false,
    eyesClosed: false,
    spots: { inScope, total, onePerson },
  });
  const sel = (s: string) => ({ ...INITIAL_SELECTION, tab: 'skin' as const, skin: s as never });

  it('祛痘 closes the strip, selects the mode, shows its dot only when the 清除 scope holds spots', () => {
    const it0 = spotItem(sel('skin.smooth'), skin());
    expect([it0.key, it0.label, it0.action, it0.selected, it0.hasValue]).toEqual(['spot', '祛痘', { type: 'spot' }, false, false]);
    expect(spotItem(sel('spot'), skin(2, 5)).hasValue).toBe(true);
    expect(spotItem(sel('spot'), skin(0, 5, true)).hasValue).toBe(false);
    expect(spotItem(sel('spot'), skin(0, 0, false, 'noFace')).disabled).toBe(false);
    expect(spotItem(sel('spot'), skin(0, 0, false, 'recovering')).reason).toBe(TONE_COPY.recovering);
    expect(showsSpotMode(sel('spot'))).toBe(true);
    expect(showsSpotMode({ ...sel('spot'), tab: 'shape' })).toBe(false);
  });

  it('lastSel never keeps the 祛痘 mode', () => {
    expect(rememberable(sel('spot')).skin).toBe('skin.smooth');
    expect(rememberable(sel('tone.even')).skin).toBe('tone.even');
  });

  it('the 清除 label follows the scope; a second tap within 3 s clears, one tap left for 3 s does not', () => {
    expect(clearLabel(3, false, false)).toBe('全部清除（3）');
    expect(clearLabel(0, true, false)).toBe('清除此人（0）');
    expect(clearLabel(3, true, true)).toBe('確定清除？');
    const t1 = clearTap(0, 1000, 3);
    expect(t1).toEqual({ confirmUntil: 1000 + CLEAR_CONFIRM_MS, clear: false });
    expect(clearTap(t1.confirmUntil, 1000 + CLEAR_CONFIRM_MS - 1, 3)).toEqual({ confirmUntil: 0, clear: true });
    expect(clearTap(t1.confirmUntil, 1000 + CLEAR_CONFIRM_MS + 1, 3)).toEqual({ confirmUntil: 1000 + 2 * CLEAR_CONFIRM_MS + 1, clear: false });
    expect(clearTap(0, 1000, 0)).toEqual({ confirmUntil: 0, clear: false });
  });

  it('the armed clear disarms when the scope or the counts change (Review Focus 3)', () => {
    const k = clearArmKey('all', 3, 3);
    expect(clearArmKey('all', 2, 2)).not.toBe(k); // ↶ removed a spot
    expect(clearArmKey('f1', 3, 3)).not.toBe(k); // another chip
    expect(clearArmKey('all', 3, 4)).not.toBe(k); // a new spot elsewhere
    expect(clearArmKey('all', 3, 3)).toBe(k);
  });

  it('the 美膚 tab dot lights for spots alone', () => {
    expect(spotsOnTab(skin(0, 3))).toBe(true);
    expect(spotsOnTab(skin(0, 0))).toBe(false);
    expect(spotsOnTab(undefined)).toBe(false);
  });

  /** one face person, every value neutral (no 美白 / 銳化 either), plus `values` */
  const lensOf = (values: Record<string, number> = {}) =>
    lensFor(
      {
        v: 2 as const,
        photo: { ...defaultPhoto(), values: { ...defaultPhoto().values, 'skin.whiten': 0, 'skin.sharpen': 0 }, spots: [] },
        persons: { f0: { ...neutralPerson(), values: { ...neutralPerson().values, ...values } } },
        template: neutralPerson(),
        primaryInit: null,
      },
      { kind: 'person', id: 'f0' },
      [{ id: 'f0', face: true, body: false }],
      'f0',
    );

  it('activating 祛痘 only selects the mode, like 增高: no edit, no undo step (S §3.6)', () => {
    const lens = lensOf();
    const r = activate(spotItem(sel('skin.smooth'), skin()), lens, sel('skin.smooth'));
    expect(r.sel.skin).toBe('spot');
    expect(r.edit).toBe(lens.edit);
    expect(activate(spotItem(sel('spot'), skin()), lens, sel('spot')).changed).toBe(false);
  });

  it('tabHasValue(美膚): spots alone, or a tone value alone, light the tab; a neutral photo does not (S §2.1)', () => {
    expect(tabHasValue(lensOf(), 'skin', undefined, skin(0, 0))).toBe(false);
    expect(tabHasValue(lensOf(), 'skin', undefined, skin(0, 2))).toBe(true);
    expect(tabHasValue(lensOf({ 'tone.nasolabial': 0.4 }), 'skin', undefined, skin(0, 0))).toBe(true);
  });

  it('a tap outside the photo (letterbox) is ignored', () => {
    expect(spotTapInside([0.5, 0.5])).toBe(true);
    expect(spotTapInside([-0.01, 0.5])).toBe(false);
    expect(spotTapInside([0.5, 1.02])).toBe(false);
  });
});
```
(In Task 16's `skin()` helper of this file, add `spots: { inScope: 0, total: 0, onePerson: false }` once `SkinPanelContext` gains the field.)

Append to `tests/e2e/tone.spec.ts` (the `defect` helper joins the file here, with its first user):
```ts
const defect = (fx: Fixture, name: string) => fx.defects.find((d) => d.name === name)!;
/** an O point (photo W × H) in page CSS px, through the frame's fitted rectangle (no zoom) */
async function pagePoint(page: Page, x: number, y: number, W: number, H: number): Promise<{ x: number; y: number }> {
  const b = (await frame(page).boundingBox())!;
  return { x: b.x + (x / W) * b.width, y: b.y + (y / H) * b.height };
}
/** standard deviation of Rec.601 luma over a disc (screenshot px) */
function discSd(p: Pixels, cx: number, cy: number, rad: number): number {
  let s = 0;
  let s2 = 0;
  let n = 0;
  for (let y = Math.floor(cy - rad); y <= Math.ceil(cy + rad); y++)
    for (let x = Math.floor(cx - rad); x <= Math.ceil(cx + rad); x++) {
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > rad) continue;
      const i = (y * p.width + x) * 4;
      const v = 0.299 * p.data[i] + 0.587 * p.data[i + 1] + 0.114 * p.data[i + 2];
      s += v;
      s2 += v * v;
      n++;
    }
  return Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2));
}
const dotSd = (p: Pixels, fx: Fixture, d: Defect) => discSd(p, (d.center[0] / fx.width) * p.width, (d.center[1] / fx.height) * p.height, ((1.2 * (d.sigma ?? 5)) / fx.width) * p.width);
/** two-finger pinch about a page point, through real touch events */
async function pinch(page: Page, cx: number, cy: number, scale: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const at = (d: number) => [
    { x: cx - d, y: cy, id: 1 },
    { x: cx + d, y: cy, id: 2 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(30) });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(30 + (30 * (scale - 1) * i) / 8) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

test('祛痘: a tap heals a blemish; ↶ brings it back, ↷ heals again; a pan while zoomed adds nothing', async ({ page }) => {
  const fx = fixture();
  const dot = defect(fx, 'dot1');
  await importPhoto(page, TONE_PNG);
  await plain(page);
  await pick(page, '美膚', '祛痘');
  await expect(page.getByText('點一下痘痘或瑕疵即可去除')).toBeVisible();
  const before = await settled(frame(page));
  const p = await pagePoint(page, dot.center[0], dot.center[1], fx.width, fx.height);
  await page.mouse.click(p.x, p.y);
  await expect.poll(async () => (await debugState(page)).spots).toBe(1);
  const healed = await settled(frame(page));
  console.log(`dot1 sd ${dotSd(before, fx, dot).toFixed(2)} → ${dotSd(healed, fx, dot).toFixed(2)}`);
  expect(dotSd(healed, fx, dot)).toBeLessThanOrEqual(0.5 * dotSd(before, fx, dot));
  await page.getByRole('button', { name: '復原' }).click();
  await expect.poll(async () => (await debugState(page)).spots).toBe(0);
  expect(mad(await settled(frame(page)), before)).toBeLessThanOrEqual(0.2);
  await page.getByRole('button', { name: '重做' }).click();
  await expect.poll(async () => (await debugState(page)).spots).toBe(1);
  expect(dotSd(await settled(frame(page)), fx, dot)).toBeLessThanOrEqual(0.5 * dotSd(before, fx, dot));
  await pinch(page, p.x, p.y, 2.5);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 20, p.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect((await debugState(page)).spots).toBe(1);
});

test('祛痘 snaps a tap made 0.5 r off a blemish onto it', async ({ page }) => {
  const fx = fixture();
  const dot = defect(fx, 'dot2');
  const rPx = 0.03 * fx.fw; // 中 = 0.030 × the face width
  await importPhoto(page, TONE_PNG);
  await plain(page);
  await pick(page, '美膚', '祛痘');
  const p = await pagePoint(page, dot.center[0] + 0.5 * rPx, dot.center[1], fx.width, fx.height);
  await page.mouse.click(p.x, p.y);
  await expect.poll(async () => (await debugState(page)).spots).toBe(1);
  const s = (await debugState(page)).lastSpot!;
  expect(Math.hypot(s.x * fx.width - dot.center[0], s.y * fx.height - dot.center[1])).toBeLessThanOrEqual(0.15 * rPx);
});

test('祛痘 refuses an eye, and stops at 100 spots', async ({ page }) => {
  const fx = fixture();
  await importPhoto(page, TONE_PNG);
  await pick(page, '美膚', '祛痘');
  const eye = defect(fx, 'scleraR').center;
  const p = await pagePoint(page, eye[0], eye[1], fx.width, fx.height);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByText('眼睛和嘴巴不適用祛痘')).toBeVisible();
  expect((await debugState(page)).spots).toBe(0);
  // one spot so the entry is saved, then 99 more written straight into IndexedDB, then reopen
  const dot = defect(fx, 'dot1').center;
  const q = await pagePoint(page, dot[0], dot[1], fx.width, fx.height);
  await page.mouse.click(q.x, q.y);
  await expect.poll(async () => (await debugState(page)).spots).toBe(1);
  await page.getByRole('button', { name: '關閉' }).click();
  await expect(page.getByRole('button', { name: '開啟編輯' })).toHaveCount(1, { timeout: 15_000 });
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('meiyan');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const store = db.transaction('edits', 'readwrite').objectStore('edits');
          const all = store.getAll();
          all.onsuccess = () => {
            const e = all.result[0] as { edit: { photo: { spots: unknown[] } } };
            for (let i = e.edit.photo.spots.length; i < 100; i++) e.edit.photo.spots.push({ x: 0.03 + (i % 10) * 0.012, y: 0.03 + Math.floor(i / 10) * 0.012, r: 0.005, dx: 0, dy: 0, owner: null });
            store.put(e).onsuccess = () => {
              db.close();
              resolve();
            };
          };
        };
      }),
  );
  await page.reload();
  await page.getByRole('button', { name: '開啟編輯' }).click();
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 90_000 });
  await expect.poll(async () => (await debugState(page)).spots).toBe(100);
  await pick(page, '美膚', '祛痘');
  const r = await pagePoint(page, 300, 1200, fx.width, fx.height);
  await page.mouse.click(r.x, r.y);
  await expect(page.getByText('祛痘點已達上限')).toBeVisible();
  expect((await debugState(page)).spots).toBe(100);
});

test('spots and tone values survive a reopen without a detector call', async ({ page }) => {
  const fx = fixture();
  await importPhoto(page, TONE_PNG);
  await pick(page, '美膚', '勻膚');
  await dragSlider(page, 200);
  await pick(page, '美膚', '祛痘');
  const dot = defect(fx, 'dot3').center;
  const p = await pagePoint(page, dot[0], dot[1], fx.width, fx.height);
  await page.mouse.click(p.x, p.y);
  await expect.poll(async () => (await debugState(page)).spots).toBe(1);
  await pick(page, '美膚', '勻膚'); // out of 祛痘 mode: no hint caption in the screenshots
  const edited = await settled(frame(page));
  const evenValue = await page.getByRole('slider').getAttribute('aria-valuenow');
  await page.waitForTimeout(800); // the 400 ms autosave
  await page.getByRole('button', { name: '關閉' }).click();
  await expect(page.getByRole('button', { name: '開啟編輯' })).toHaveCount(1, { timeout: 15_000 });
  await page.reload();
  const calls = (await debugState(page)).detectCalls;
  await page.getByRole('button', { name: '開啟編輯' }).click();
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 90_000 });
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 10_000 });
  expect((await debugState(page)).spots).toBe(1);
  expect((await debugState(page)).detectCalls).toBe(calls);
  await pick(page, '美膚', '勻膚');
  await expect(page.getByRole('slider')).toHaveAttribute('aria-valuenow', evenValue!);
  expect(mad(await settled(frame(page)), edited)).toBeLessThanOrEqual(0.2);
});

test('per person: a tap on face 1 belongs to person 1; 清除此人 and 全部清除 with the second tap', async ({ page }) => {
  await importPhoto(page, GROUP_PNG);
  const boxes = (await debugState(page)).boxes;
  await selectPerson(page, 2);
  await pick(page, '美膚', '祛痘');
  const b = (await frame(page).boundingBox())!;
  const cheek = { x: boxes[0].x + 0.3 * boxes[0].w, y: boxes[0].y + 0.62 * boxes[0].h };
  await page.mouse.click(b.x + cheek.x * b.width, b.y + cheek.y * b.height);
  await expect.poll(async () => (await debugState(page)).spots).toBe(1);
  expect((await debugState(page)).lastSpot!.owner).toBe('f0');
  await expect(page.getByRole('button', { name: '清除此人（0）' })).toBeDisabled();
  await selectPerson(page, 0);
  const clear = page.getByRole('button', { name: '全部清除（1）' });
  await clear.click();
  await expect(page.getByRole('button', { name: '確定清除？' })).toBeVisible();
  await page.waitForTimeout(3200);
  await expect(page.getByRole('button', { name: '全部清除（1）' })).toBeVisible();
  expect((await debugState(page)).spots).toBe(1);
  await page.getByRole('button', { name: '全部清除（1）' }).click();
  await page.getByRole('button', { name: '確定清除？' }).click();
  await expect.poll(async () => (await debugState(page)).spots).toBe(0);
  // the clear is one undo step (S §8.1)
  await page.getByRole('button', { name: '復原' }).click();
  await expect.poll(async () => (await debugState(page)).spots).toBe(1);
});

test('a photo without a face: 祛痘 still heals', async ({ page }) => {
  await importPhoto(page, { name: 'noface.png', mimeType: 'image/png', buffer: noFaceDotPng() });
  await pick(page, '美膚', '祛痘');
  const before = await settled(frame(page));
  const p = await pagePoint(page, 300, 400, 600, 800);
  await page.mouse.click(p.x, p.y);
  await expect.poll(async () => (await debugState(page)).spots).toBe(1);
  const after = await settled(frame(page));
  const sd = (img: Pixels) => discSd(img, (300 / 600) * img.width, (400 / 800) * img.height, (6 / 600) * img.width);
  expect(sd(after)).toBeLessThanOrEqual(0.5 * sd(before));
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/ui/panelModel.test.ts src/engine/backMapFrame.test.ts`
Expected: FAIL — `spotItem is not a function` (and the other new names); `Failed to resolve import "./backMapFrame"`.

- [ ] **Step 3: Implement**

Create `src/engine/backMapFrame.ts`:
```ts
// The CPU back-map of the frame the editor shows (skin-cleanup spec §3.4 cpuSample): Geo⁻¹ (backMapCpu), then the
// O-space part of P2 — the 美體 field and every listed face's warp chain with its cap and limit — built from the
// frame exactly as the engine's job() and tableFaces() build the face table. Taps only: never in a render path.
import { MAX_RENDER_FACES } from '../config/limits';
import type { BodyField, Geometry, RenderFace, Size } from '../types';
import type { BackMapFrame } from './backMapCpu';
import { boxCentre, ovalBox } from './passes/faceCap';
import { makeupUniformsFor } from './passes/makeup';
import { reshapeUniforms, type ReshapeUniforms } from './passes/reshape';
import { reshapeMapMulti } from './passes/reshapeCpu';
import { tableFaces, type FrameFace } from './pipeline';

export interface BackMapInput {
  faces: readonly RenderFace[];
  obstacles?: readonly (readonly [number, number])[];
  body?: BodyField | null;
  geometry: Geometry;
}

/** λ_f of the editor's fold safety net (RenderFace.warpScale), applied as index.ts's scaleUniforms does */
function scaled(u: ReshapeUniforms, k: number): ReshapeUniforms {
  if (k === 1) return u;
  const o = { ...u };
  for (const key of Object.keys(o) as (keyof ReshapeUniforms)[]) o[key] *= Math.min(1, Math.max(0, k));
  return o;
}

export function backMapFrameOf(input: BackMapInput, oSize: Size): BackMapFrame {
  const aspect = oSize.width / oSize.height;
  const faces: FrameFace[] = input.faces.slice(0, MAX_RENDER_FACES).map((f) => {
    const w = Math.min(1, Math.max(0, Number.isFinite(f.weight) ? f.weight : 0));
    return {
      face: f.face,
      weight: w,
      reshape: scaled(reshapeUniforms(f.person.values, w), f.warpScale ?? 1),
      makeup: makeupUniformsFor(f.person, w),
      kS: 1, // tableFaces reads neither kS nor kR
      kR: 1,
      protect: f.protect,
      centre: boxCentre(ovalBox(f.face)),
      presence: f.presence ?? 1,
    };
  });
  const t = tableFaces({ faces, obstacles: input.obstacles ?? [] }, aspect);
  return { geometry: input.geometry, oSize, oMap: reshapeMapMulti(t.faces, aspect, { body: input.body ?? null, protects: t.protects }) };
}
```
(This mirrors `job()`'s face list, `index.ts:304-322`, λ_f included; if a later step adds an O-space map to P2 — step 6's liquify — it extends this function too.)

`src/ui/panelModel.ts`:
- `export type SkinSel = ParamId | 'spot';` and `PanelSelection.skin: SkinSel` (`panelModel.ts:42`).
- `ItemAction` gains `/** 美膚: select the 祛痘 tap mode (the screen shows SpotControls) */ | { type: 'spot' }`.
- `SkinPanelContext` gains:
  ```ts
  /** the 清除 scope's spots, every spot of the photo, and whether 清除 means 清除此人 */
  spots: { inScope: number; total: number; onePerson: boolean };
  ```
- add:
  ```ts
  export function showsSpotMode(sel: PanelSelection): boolean {
    return sel.tab === 'skin' && sel.skin === 'spot';
  }

  /** what the module-level lastSel may keep: never the 祛痘 mode, so a first touch on the next photo cannot add a spot */
  export function rememberable(sel: PanelSelection): PanelSelection {
    return sel.skin === 'spot' ? { ...sel, skin: 'skin.smooth' } : sel;
  }

  export function spotItem(sel: PanelSelection, skin: SkinPanelContext): PanelItem {
    return gated(
      {
        key: 'spot',
        label: '祛痘',
        visual: { kind: 'icon', icon: 'spot' },
        selected: sel.skin === 'spot',
        hasValue: skin.spots.inScope > 0,
        action: { type: 'spot' },
        ...ENABLED,
      },
      skinToolGate('spot', skin),
    );
  }

  export const CLEAR_CONFIRM_MS = 3000;

  export function clearLabel(count: number, onePerson: boolean, confirming: boolean): string {
    if (confirming) return TONE_COPY.clearConfirm;
    return onePerson ? TONE_COPY.clearPerson(count) : TONE_COPY.clearAll(count);
  }

  /** the two-tap clear: the first tap arms it for 3 s, a second tap within that time clears; nothing to clear → nothing */
  export function clearTap(confirmUntil: number, now: number, count: number): { confirmUntil: number; clear: boolean } {
    if (count <= 0) return { confirmUntil: 0, clear: false };
    if (now < confirmUntil) return { confirmUntil: 0, clear: true };
    return { confirmUntil: now + CLEAR_CONFIRM_MS, clear: false };
  }

  /** an armed clear is disarmed whenever this changes: the scope, its count or the photo's count (↶ ↷, a new spot, a chip) */
  export function clearArmKey(scope: string, inScope: number, total: number): string {
    return `${scope}|${inScope}|${total}`;
  }

  /** a tap outside the photo (the letterbox around it) adds nothing */
  export function spotTapInside(uv: readonly [number, number]): boolean {
    return uv[0] >= 0 && uv[0] <= 1 && uv[1] >= 0 && uv[1] <= 1;
  }

  /** the 美膚 tab dot also lights while the photo has spots (S §2.1) */
  export function spotsOnTab(skin: SkinPanelContext | undefined): boolean {
    return (skin?.spots.total ?? 0) > 0;
  }
  ```
- `itemsFor` (the 4th parameter `skin` from Task 16): the Task 16 append becomes `...(sel.tab === 'skin' && skin ? [...toneItems(lens, sel, skin), spotItem(sel, skin)] : [])`.
- `activate`: next to step 1's `case 'height': return done(edit, sel.body === 'height' ? sel : { ...sel, body: 'height' });` (`panelModel.ts:717-718`) add (select only, no edit, like 增高)
  ```ts
      case 'spot':
        return done(edit, sel.skin === 'spot' ? sel : { ...sel, skin: 'spot' });
  ```
  and in `case 'param'`, the non-body branch keeps `{ ...sel, skin: a.id }` (a param id leaves the 祛痘 mode).
- `sliderFor`, Task 16's `case 'skin': case 'shape':` block: right after `const id = sel[sel.tab];` add `if (id === 'spot') return null; // 祛痘: SpotControls takes the slider row` (this also narrows `id` to `ParamId` for `isToneId`, `usable`, `paramBinding` and `photoLike`).
- `tabHasValue(lens: Lens, tab: TabId, body?: BodyContext, skin?: SkinPanelContext)` (`panelModel.ts:897`; the 4th parameter moves here from Task 16): in its case `'skin'` (shared with `'shape'` / `'makeup'` in step 1, `:908-911`) put `if (tab === 'skin' && spotsOnTab(skin)) return true;` before `return lens.groupHasValue(tab);`. In `BeautyPanel.tsx:224` the call becomes `tabHasValue(lens, t.id, body, skin)`.
- `photoScoped` (`panelModel.ts:211-219`): its line `if (sel.tab === 'skin') return photoLike(lens, sel.skin);` would hand `'spot'` to `photoLike` (a `ParamId` only; `paramDef('spot')` throws). In 祛痘 mode the chips stay live, because the selection picks 清除此人's person: write `if (sel.tab === 'skin') return sel.skin !== 'spot' && photoLike(lens, sel.skin);`.
- Task 16's `toneItems` / `skinNote` compare `sel.skin` with tone ids; `isToneId(sel.skin)` is false for `'spot'`, so they need no change.

Create `src/ui/components/SpotControls.tsx`:
```tsx
// 祛痘 mode controls (skin-cleanup spec §2.3): 大小 小｜中｜大 and the 清除 button, in the slider row's place and height.
import type { SpotSize } from '../../types';
import { TONE_COPY } from '../../edit/toneCopy';
import { Segmented } from './Controls';

const SIZES: readonly { value: SpotSize; label: string }[] = [
  { value: 'S', label: '小' },
  { value: 'M', label: '中' },
  { value: 'L', label: '大' },
];

export function SpotControls({ size, onSize, label, disabled, confirming, onClear }: {
  size: SpotSize;
  onSize(s: SpotSize): void;
  label: string;
  disabled: boolean;
  confirming: boolean;
  onClear(): void;
}) {
  return (
    <div class="slider-row spot-controls">
      <span class="slider-label">{TONE_COPY.spotSize}</span>
      <Segmented value={size} options={SIZES} onChange={onSize} label={TONE_COPY.spotSize} />
      <button type="button" class={`spot-clear${confirming ? ' confirm' : ''}`} disabled={disabled} onClick={onClear}>
        {label}
      </button>
    </div>
  );
}
```
Create `src/ui/components/SpotOverlay.tsx`:
```tsx
// 祛痘 tap feedback (skin-cleanup spec §2.3): a 1.5 px accent ring at the finger with the spot's on-screen radius, inside
// .zoom-layer (its stroke divided by the zoom scale --zs), scaling 1.15 → 1 and fading out over 350 ms. Visual only.
export interface SpotRing {
  id: number;
  /** layer-normalized centre */
  x: number;
  y: number;
  /** radius as a fraction of the layer width */
  r: number;
}

export function SpotOverlay({ rings }: { rings: readonly SpotRing[] }) {
  return (
    <div class="spot-overlay" aria-hidden="true">
      {rings.map((g) => (
        <i key={g.id} class="spot-ring" style={{ left: `${g.x * 100}%`, top: `${g.y * 100}%`, width: `${g.r * 200}%` }} />
      ))}
    </div>
  );
}
```
`src/ui/icons.tsx` — after Task 16's `eyeBright`:
```tsx
  spot: (
    <>
      <circle cx="12" cy="12" r="6.4" />
      <circle cx="12" cy="12" r="1.5" />
      <path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6" />
    </>
  ),
```
`src/ui/theme.css` (CRLF), after the `.zoom-layer` rules (v0.3 ~line 1617):
```css
.spot-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.spot-ring {
  position: absolute;
  aspect-ratio: 1;
  border: calc(1.5px / var(--zs, 1)) solid var(--accent);
  border-radius: 50%;
  transform: translate(-50%, -50%);
  animation: spot-ring 350ms ease-out forwards;
}
@keyframes spot-ring {
  from {
    transform: translate(-50%, -50%) scale(1.15);
    opacity: 1;
  }
  to {
    transform: translate(-50%, -50%) scale(1);
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .spot-ring {
    animation: none;
  }
}
.corner-label.spot-hint {
  left: 50%;
  transform: translateX(-50%);
  white-space: nowrap;
}
.spot-controls .segmented button {
  min-width: 44px;
}
.spot-clear {
  margin-left: auto;
  height: 32px;
  padding: 0 12px;
  border-radius: 16px;
  font-size: 13px;
  font-weight: 600;
  background: rgba(255, 255, 255, 0.1);
  color: var(--text);
}
.spot-clear.confirm {
  background: var(--danger);
  color: #fff;
}
.spot-clear:disabled {
  opacity: 0.4;
}
```
`src/ui/screens/Editor.tsx`:
1. Module state next to `lastSel` (`Editor.tsx:121`): `let lastSpotSize: SpotSize = 'M';` and `setSel` (`:419-424`, today `lastSel = s;`) stores `lastSel = rememberable(s);`.
2. Component state — top-level hooks, placed above Task 16's `skinCtx` block (which reads `clearSc` / `inScope`) and so above the `useZoomPan` call (which reads `spotMode`). The Editor already has a `const scope = multi && photoScoped(sel, lens);` (`:1445`, the strip's photo scope), so the 清除 scope is `clearSc`:
   ```ts
  const [spotSize, setSpotSizeState] = useState<SpotSize>(lastSpotSize);
  const setSpotSize = (s: SpotSize) => {
    lastSpotSize = s;
    setSpotSizeState(s);
  };
  const [confirmUntil, setConfirmUntil] = useState(0);
  const [rings, setRings] = useState<SpotRing[]>([]);
  const ringSeq = useRef(0);
  const zoomHintDone = useRef(false);
  const spotMode = !!session && showsSpotMode(sel);
  const clearSc = clearScope(selected, detect?.persons.length ?? 0);
  const inScope = spotsInScope(edit, clearSc);
  const armKey = clearArmKey(String(clearSc), inScope, edit.photo.spots.length);
  useEffect(() => setConfirmUntil(0), [armKey]);
  useEffect(() => {
    if (!confirmUntil) return;
    const t = window.setTimeout(() => setConfirmUntil(0), Math.max(0, confirmUntil - performance.now()));
    return () => clearTimeout(t);
  }, [confirmUntil]);
  useEffect(() => debug({ spots: edit.photo.spots.length }), [edit.photo.spots]);
   ```
   and Task 16's `skinCtx` gains `spots: { inScope, total: edit.photo.spots.length, onePerson: clearSc !== 'all' }`.
3. The tap (S §3.4) — placed after item 2's block (so also after `const hold = useHold(…)`, `Editor.tsx:1143`) and before the `useZoomPan` call:
   ```ts
  /** 祛痘: a tap (V uv) → O through the CPU back-map → refusals, radius, patch, snap and donor, owner → one undo step */
  const tapSpot = (v: [number, number]) => {
    const s = sessionRef.current;
    if (!s || hold.held || !spotTapInside(v)) return;
    const cur = editRef.current;
    if (cur.photo.spots.length >= SPOT_CAP) {
      toast(TONE_COPY.spotCap, 2600);
      return;
    }
    let o: [number, number];
    try {
      // the frame the session shows for `cur`: every face with its person's params, limit and λ_f (step 1's frameOf)
      const f = frameOf(cur, s);
      o = backMapCpu(v, backMapFrameOf({ faces: f.faces, obstacles: f.obstacles, body: s.body, geometry: cur.photo.geometry }, photo));
    } catch (e) {
      reportError(e, 'backMapCpu');
      return;
    }
    const aspect = photo.width / photo.height;
    const faces = (s.faces ?? []).map((f) => ({ id: f.id, face: f.face }));
    const region = regionAt(o, faces, aspect);
    if (region.kind === 'eye' || region.kind === 'mouth') {
      toast(TONE_COPY.spotRefused, 2600);
      return;
    }
    const r = spotRadius(o, spotSize, faces, photo);
    let res: PlanResult;
    try {
      res = planSpot(readPatch(source.bitmap, patchPlan(o, r, photo)), o, r, { faces, aspect, existing: cur.photo.spots });
    } catch (e) {
      reportError(e, 'readPatch');
      res = { x: o[0], y: o[1], r, dx: 0, dy: 0, owner: null };
    }
    if ('refused' in res) {
      toast(res.refused === 'cap' ? TONE_COPY.spotCap : TONE_COPY.spotRefused, 2600);
      return;
    }
    const spot = { ...res, owner: ownerAt([res.x, res.y], ownerCtxOf(detect, faces, aspect)) };
    haptic();
    const short = Math.min(photo.width, photo.height);
    const vWidth = viewSize(cur.photo.geometry, photo).width;
    const id = ++ringSeq.current;
    setRings((rs) => [...rs, { id, x: v[0], y: v[1], r: (r * short) / vWidth }]);
    window.setTimeout(() => setRings((rs) => rs.filter((g) => g.id !== id)), 350);
    const layerW = layerRef.current?.getBoundingClientRect().width ?? 0;
    if (!zoomHintDone.current && 2 * r * short * (layerW / vWidth) < 12) {
      zoomHintDone.current = true;
      toast(TONE_COPY.zoomHint, 2600);
    }
    debug({ lastSpot: spot });
    update(addSpot(cur, spot), true);
  };
   ```
   Names from earlier steps: `editRef` / `update(edit, commit)` are step 1's state ref and update function (`Editor.tsx:130-132`, `:430`); `frameOf(e, s)` (`:366-369`) builds the `StillFrame` session `s` renders for `e` (`buildFrame` with the cache faces, obstacles, limits, primary and the λ_f `warpScales`), so no frame ref is needed; `s.body` is the session's 美體 field (`StillSession.body`); `s.faces` is step 1's `SessionFace[]`; `detect` and `selected` as in Task 16; `photo` is `{width, height}` (`Editor.tsx:265`); `reportError(err, where)` and `toast(text, ms)` as the Editor uses them. Imports (merged into the existing declarations): `addSpot`, `clearScope`, `clearSpots`, `ownerAt`, `ownerCtxOf`, `planSpot`, `regionAt`, `spotRadius`, `spotsInScope`, `type PlanResult` from `../../edit/spots`; `patchPlan`, `readPatch` from `../../edit/patch`; `SPOT_CAP` from `../../config/limits`; `TONE_COPY` from `../../edit/toneCopy`; `backMapCpu` from `../../engine/backMapCpu`; `backMapFrameOf` from `../../engine/backMapFrame`; `viewSize` added to the `../../geometry/view` import (`:42`); `clearArmKey`, `clearLabel`, `clearTap`, `rememberable`, `showsSpotMode`, `spotTapInside` added to the `../panelModel` import; `SpotControls`; `SpotOverlay`, `type SpotRing`; `type SpotSize` added to the `../../types` type import (`:33`). `debug`, `reportError`, `toast` and `haptic` are already imported.
4. The clear:
   ```ts
  const onClear = () => {
    const r = clearTap(confirmUntil, performance.now(), inScope);
    setConfirmUntil(r.confirmUntil);
    haptic();
    if (r.clear) update(clearSpots(editRef.current, clearSc), true);
  };
   ```
5. zoomPan (`Editor.tsx:1415-1427`): step 1 / 3 pass the person hit test inline, `onTap: tapsOn ? (uv, rect) => { wakeBoxes(); … if (hit) choose({ kind: 'person', id: hit }); } : undefined`. Lift that expression unchanged into a named `const onPersonTap = tapsOn ? (uv: [number, number], rect: DOMRect) => { … } : undefined;` right above the call (step 6's plan refers to it as `onPersonTap`, "as step 4 calls it"), then: `useZoomPan(stageRef, layerRef, !!session && !cropMode, { onTap: spotMode ? undefined : onPersonTap, spotTap: spotMode ? tapSpot : undefined, resetWhen: cropMode });`
6. JSX: inside `.zoom-layer` (`Editor.tsx:1527-1575`, after the `BandPlane` block) add `{spotMode && !hold.held && <SpotOverlay rings={rings} />}`; step 1's FaceBoxes visibility, `const showBoxes = … && !showsHeightBand(sel, bodyCtx);` (`:1469`), gains `&& !spotMode`; inside `.frame` next to the `原圖` corner label (`{hold.held && <span class="corner-label">原圖</span>}`, `:1586`) add `{spotMode && !hold.held && <span class="corner-label spot-hint">{TONE_COPY.spotHint}</span>}`; in `.editor-panel` (`:1607-1629`) wrap step 3's `<SliderRow … />` (`:1611-1616`, with its `cropMode ? straightenView(g) : binding` binding and `emptyText`, all kept) in the 祛痘 alternative:
   ```tsx
        {spotMode ? (
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
          />
        )}
   ```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/ui src/engine/backMapFrame.test.ts && npm run typecheck`
Expected: PASS.
Run: `npm run build && npx playwright test tests/e2e/tone.spec.ts tests/e2e/editor.spec.ts tests/e2e/persons.spec.ts`
Expected: all pass; the log prints `dot1 sd … → …`.

- [ ] **Step 5: Commit**

```bash
git add src/engine/backMapFrame.ts src/engine/backMapFrame.test.ts src/ui/panelModel.ts src/ui/panelModel.test.ts src/ui/components/SpotControls.tsx src/ui/components/SpotOverlay.tsx src/ui/screens/Editor.tsx src/ui/icons.tsx src/ui/theme.css tests/e2e/tone.spec.ts
git commit -m "v0.4 step 4 (17/20): 祛痘 tap mode in the editor" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Tiled export — `toneSource`, the spot window rule, the GL budget; spots under the geometry

**Files:**
- Modify: `src/engine/pipeline.ts` (CRLF; the `Pipeline` interface `:223-244` and object: `toneFieldReady`, `prepareToneField`), `src/engine/index.ts` (CRLF; step 3's `renderTile` `:431-447`), `src/app/still.ts` (LF; step 3's `StillSession.tileInput` `:359-366`, `bounds` `:367-369`)
- Modify: `src/media/exportPlan.ts` (LF; step 3's module: `spotWindowGrowth`, `step4Active`, `spotBounds` — the values of its `TileBounds.spotWindowGrowth` / `oSpacePasses` hooks, `exportPlan.ts:116-127`, which `planTiles` (`:213`) and `chooseTile` / `tileBytes` (`:225-238`) already read)
- Test: `src/media/exportPlan.test.ts`, `tests/e2e/pages/tone.ts` (`runToneTiles`), `tests/e2e/tone-engine.spec.ts`, `tests/e2e/tone.spec.ts`

**Interfaces:**
- Consumes: Tasks 11, 14 (the pipeline's tone cache, `buildToneField`, heal); `RenderInput.toneSource` (Task 11); step 3's `Engine.renderTile(input, read: PxRect): ImageData`, `RenderInput.sourceWindow` / `output`, `PxRect`, `Rect`, `Size`; step 3's planner hooks `TileBounds { body; faces; liquifyMaxDisp?; spotWindowGrowth?: (winO: Rect) => Rect; oSpacePasses?: boolean }` — `planTiles` applies `bounds.spotWindowGrowth(winO)` to each O-normalized window before snapping it to the decode grid, `chooseTile` budgets each tile with `tileBytes(t, !!bounds.oSpacePasses)` = `(3·win + 2·buf)·4` B when set (step-3 plan Task 9); `StillSession.tileInput(frame, body?)` and `bounds(frame, body?)` (step-3 plan Task 11); step 1's `StillFrame` (`faces: RenderFace[]`, `photo`); `toneValuesOf`, `toneActive` (Task 5).
- Produces:
  ```ts
  // src/engine/pipeline.ts — Pipeline gains
  toneFieldReady(key: string): boolean;
  prepareToneField(tj: ToneJob, src: Texture): void;   // `src` holds the working image (toneSource) at tj.work
  // src/media/exportPlan.ts
  export function spotWindowGrowth(winO: Rect, spots: readonly Spot[], oSize: Size): Rect;   // O-normalized in and out; oSize: any size with the O aspect (its px set the 1-px tap margin)
  export function step4Active(frame: Pick<StillFrame, 'faces' | 'photo'>): boolean;
  export function spotBounds(frame: Pick<StillFrame, 'faces' | 'photo'>, oSize: Size): Pick<TileBounds, 'spotWindowGrowth' | 'oSpacePasses'>;
  // tests/e2e/pages/tone.ts
  window.runToneTiles(): Promise<{ warm: number; cold: number; tiles: number }>  // max channel differences, tiled vs untiled
  ```
  S §4.6: the tone field is one global texture from the working image (`toneSource`); a tile whose engine has no matching field rebuilds it once from `toneSource` (P0b and P0c at working resolution) before its own passes. Each spot whose quad (1.1 r) meets a tile's source window grows the window to hold bbox(c ± 1.4 r) ∪ bbox(c + d ± 1.4 r).

- [ ] **Step 1: Write the failing tests**

Append to `src/media/exportPlan.test.ts` (imports: `spotBounds`, `spotWindowGrowth`, `tileBytes` from `./exportPlan`; `defaultPhoto`, `neutralPerson` from `../edit/state`; `makeFace` from `../app/testFakes`; `type Rect`, `type Spot` from `../types`):
```ts
describe('step 4: spot windows and the GL budget (skin-cleanup spec §4.6)', () => {
  const decode = { width: 4000, height: 3000 };
  const spot = (x: number, y: number, dx = 0.02, dy = 0): Spot => ({ x, y, r: 0.01, dx, dy, owner: null });
  const toO = (r: Rect): Rect => ({ x: r.x / decode.width, y: r.y / decode.height, w: r.w / decode.width, h: r.h / decode.height });
  const toPx = (r: Rect): Rect => ({ x: r.x * decode.width, y: r.y * decode.height, w: r.w * decode.width, h: r.h * decode.height });
  const eps = 1e-6;
  const contains = (o: Rect, x0: number, y0: number, x1: number, y1: number) => {
    const w = toPx(o);
    return (
      w.x <= Math.max(0, x0) + eps &&
      w.y <= Math.max(0, y0) + eps &&
      w.x + w.w >= Math.min(decode.width, x1) - eps &&
      w.y + w.h >= Math.min(decode.height, y1) - eps
    );
  };

  it('a spot whose quad meets the window brings its ring and donor boxes in', () => {
    const win = toO({ x: 1000, y: 1000, w: 1000, h: 1000 });
    const s = spot(2010 / 4000, 1500 / 3000); // centre 10 px right of the window, r = 30 px, quad 33 px
    const g = spotWindowGrowth(win, [s], decode);
    const r = 30;
    expect(contains(g, 2010 - 1.4 * r, 1500 - 1.4 * r, 2010 + 1.4 * r, 1500 + 1.4 * r)).toBe(true);
    expect(contains(g, 2010 + 60 - 1.4 * r, 1500 - 1.4 * r, 2010 + 60 + 1.4 * r, 1500 + 1.4 * r)).toBe(true);
  });

  it('a spot far away leaves the window alone; growth chains to spots the grown window now meets', () => {
    const win = toO({ x: 1000, y: 1000, w: 1000, h: 1000 });
    expect(spotWindowGrowth(win, [spot(0.9, 0.9)], decode)).toEqual(win);
    const a = spot(2010 / 4000, 0.5, 0.03); // its donor reaches x = 2010 + 90 + 42
    const b = spot(2160 / 4000, 0.5, 0); // quad from 2127: met only by the grown window
    const g = spotWindowGrowth(win, [b, a], decode);
    expect(contains(g, 2160 - 42, 1500 - 42, 2160 + 42, 1500 + 42)).toBe(true);
  });

  it('clips to the photo', () => {
    const g = spotWindowGrowth(toO({ x: 0, y: 0, w: 100, h: 100 }), [spot(0.001, 0.001, -0.02, -0.02)], decode);
    expect(g.x).toBe(0);
    expect(g.y).toBe(0);
  });

  it('the planner hooks: B at window size while a step-4 pass runs; the window growth only with spots', () => {
    const f0 = { faces: [], photo: { ...defaultPhoto(), spots: [] as Spot[] } };
    expect(spotBounds(f0, decode)).toEqual({ oSpacePasses: false });
    const withSpot = { ...f0, photo: { ...f0.photo, spots: [spot(0.5, 0.5)] } };
    const b = spotBounds(withSpot, decode);
    expect(b.oSpacePasses).toBe(true);
    const win = { x: 0.49, y: 0.49, w: 0.002, h: 0.002 };
    expect(b.spotWindowGrowth!(win)).toEqual(spotWindowGrowth(win, withSpot.photo.spots, decode));
    const person = { ...neutralPerson(), values: { ...neutralPerson().values, 'tone.teeth': 0.4 } };
    const toned = { faces: [{ face: makeFace(), weight: 1, person, protect: null }], photo: f0.photo };
    expect(spotBounds(toned, decode).oSpacePasses).toBe(true);
    expect(spotBounds({ ...toned, faces: [{ ...toned.faces[0], weight: 0 }] }, decode).oSpacePasses).toBe(false);
    const t = { out: { x: 0, y: 0, w: 1024, h: 1024 }, buf: { x: 0, y: 0, w: 1060, h: 1060 }, win: { x: 0, y: 0, w: 1100, h: 1100 } };
    expect(tileBytes(t, true)).toBe((3 * 1100 * 1100 + 2 * 1060 * 1060) * 4);
  });

  it('coverage: through planTiles, every spot whose quad meets a tile window has both 1.4 r boxes inside it (A5)', () => {
    const dec = { width: 400, height: 600 };
    const spots: Spot[] = [
      { x: 256 / 400, y: 0.42, r: 0.025, dx: 0.075, dy: 0, owner: null },
      { x: 0.3, y: 256 / 600, r: 0.025, dx: 0, dy: 0.075, owner: null },
      { x: 0.6, y: 512 / 600, r: 0.025, dx: -0.075, dy: 0, owner: null },
    ];
    const bounds: TileBounds = { body: null, faces: [], ...spotBounds({ faces: [], photo: { ...defaultPhoto(), spots } }, dec) };
    const tiles = planTiles({ V: dec, decode: dec, geometry: IDENTITY_GEOMETRY, oAspect: dec.width / dec.height, fullShortEdge: 400 }, bounds, 256);
    const short = Math.min(dec.width, dec.height);
    let met = 0;
    for (const t of tiles) {
      // the grown window before step 3's outward snap to the 4-px grid lies within 4 px inside `win` (except where clipped)
      const x0 = t.win.x === 0 ? 0 : t.win.x + 4;
      const y0 = t.win.y === 0 ? 0 : t.win.y + 4;
      const x1 = t.win.x + t.win.w === dec.width ? dec.width : t.win.x + t.win.w - 4;
      const y1 = t.win.y + t.win.h === dec.height ? dec.height : t.win.y + t.win.h - 4;
      for (const s of spots) {
        const cx = s.x * dec.width;
        const cy = s.y * dec.height;
        const r = s.r * short;
        if (cx + 1.1 * r <= x0 || cx - 1.1 * r >= x1 || cy + 1.1 * r <= y0 || cy - 1.1 * r >= y1) continue;
        met++;
        for (const [bx, by] of [[cx, cy], [cx + s.dx * short, cy + s.dy * short]]) {
          expect(Math.max(0, bx - 1.4 * r)).toBeGreaterThanOrEqual(t.win.x);
          expect(Math.max(0, by - 1.4 * r)).toBeGreaterThanOrEqual(t.win.y);
          expect(Math.min(dec.width, bx + 1.4 * r)).toBeLessThanOrEqual(t.win.x + t.win.w);
          expect(Math.min(dec.height, by + 1.4 * r)).toBeLessThanOrEqual(t.win.y + t.win.h);
        }
      }
    }
    expect(met).toBeGreaterThan(spots.length); // the spots straddle tile borders, so several tiles meet each
  });
});
```
(`planTiles`, `IDENTITY_GEOMETRY` and `type TileBounds` are imported at the top of this file by step 3's planner tests. This case is also what step 6's release-gate plan points to for handing spots to the planner.)

Add to `tests/e2e/pages/tone.ts` (imports: `spotWindowGrowth` from `../../../src/media/exportPlan`; `type Engine` from `../../../src/types`):
```ts
declare global {
  interface Window {
    runToneTiles?: () => Promise<{ warm: number; cold: number; tiles: number }>;
  }
}

/** a pixel rect snapped outward to multiples of 4, then clipped (the step-3 planner's order) */
function snapClip(r: { x: number; y: number; w: number; h: number }, W0: number, H0: number) {
  const x0 = Math.max(0, Math.floor(r.x / 4) * 4);
  const y0 = Math.max(0, Math.floor(r.y / 4) * 4);
  const x1 = Math.min(W0, Math.ceil((r.x + r.w) / 4) * 4);
  const y1 = Math.min(H0, Math.ceil((r.y + r.h) / 4) * 4);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** 黑眼圈, 白牙, 亮眼 and 勻膚 on, three spots across 256-px tile borders: tiled (warm cache, then a fresh engine) vs untiled */
window.runToneTiles = async () => {
  const fullRes = await fixtureBitmap();
  const W0 = 400;
  const H0 = 600;
  const c = new OffscreenCanvas(W0, H0);
  c.getContext('2d')!.drawImage(fullRes, 0, 0, W0, H0);
  fullRes.close();
  const bmp = await createImageBitmap(c, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const v: ToneValues = { ...NEUTRAL_TONE, even: 0.5, darkCircle: 1, teeth: 1, eyeBright: 1 };
  const spots: Spot[] = [
    { x: 256 / W0, y: 0.42, r: 0.025, dx: 0.075, dy: 0, owner: null },
    { x: 0.3, y: 256 / H0, r: 0.025, dx: 0, dy: 0.075, owner: null },
    { x: 0.6, y: 512 / H0, r: 0.025, dx: -0.075, dy: 0, owner: null },
  ];
  const toneSource = { source: bmp, width: W0, height: H0 };
  const T = 256;
  const apron = 16; // ⌈14·k⌉ + 2 = 10 at k = 400/720, rounded up to 4, plus a margin
  let tiles = 0;
  const tiled = async (engine: Engine): Promise<ImageData> => {
    const out = new ImageData(W0, H0);
    for (let ty = 0; ty < H0; ty += T)
      for (let tx = 0; tx < W0; tx += T) {
        const o = { x: tx, y: ty, w: Math.min(T, W0 - tx), h: Math.min(T, H0 - ty) };
        const buf = snapClip({ x: o.x - apron, y: o.y - apron, w: o.w + 2 * apron, h: o.h + 2 * apron }, W0, H0);
        const g = spotWindowGrowth({ x: buf.x / W0, y: buf.y / H0, w: buf.w / W0, h: buf.h / H0 }, spots, { width: W0, height: H0 });
        const grown = { x: g.x * W0, y: g.y * H0, w: g.w * W0, h: g.h * H0 };
        const win = snapClip({ x: grown.x - 4, y: grown.y - 4, w: grown.w + 8, h: grown.h + 8 }, W0, H0);
        const crop = await createImageBitmap(bmp, win.x, win.y, win.w, win.h);
        const img = engine.renderTile(
          {
            ...inputFor(crop, v, spots),
            width: win.w,
            height: win.h,
            oAspect: W0 / H0, // tiles must pass the working aspect (step 3, RenderInput.oAspect)
            sourceWindow: { x: win.x / W0, y: win.y / H0, w: win.w / W0, h: win.h / H0 },
            output: { tile: { x: buf.x / W0, y: buf.y / H0, w: buf.w / W0, h: buf.h / H0 }, pixelSize: { width: buf.w, height: buf.h }, fullShortEdge: W0 },
            toneSource,
          },
          { x: o.x - buf.x, y: o.y - buf.y, w: o.w, h: o.h },
        );
        crop.close();
        for (let y = 0; y < o.h; y++) out.data.set(img.data.subarray(y * o.w * 4, (y + 1) * o.w * 4), ((o.y + y) * W0 + o.x) * 4);
        tiles++;
      }
    return out;
  };
  const maxDiff = (a: ImageData, b: ImageData) => {
    let m = 0;
    for (let i = 0; i < a.data.length; i++) if (i % 4 !== 3) m = Math.max(m, Math.abs(a.data[i] - b.data[i]));
    return m;
  };
  const newEngine = async () => {
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    const e = createEngine(canvas, { mirror: false });
    await e.ready;
    return e;
  };
  const warmEngine = await newEngine();
  const whole = warmEngine.renderToImageData({ ...inputFor(bmp, v, spots), toneSource }, { mirror: false });
  const warm = maxDiff(whole, await tiled(warmEngine));
  warmEngine.dispose();
  const coldEngine = await newEngine();
  const cold = maxDiff(whole, await tiled(coldEngine));
  coldEngine.dispose();
  bmp.close();
  return { warm, cold, tiles };
};
```
Append to `tests/e2e/tone-engine.spec.ts`:
```ts
test('tiles: a forced 256-px tiling equals the untiled render within 1/255, also when the field is rebuilt from toneSource', async ({ page }) => {
  await openHarness(page, 'runToneTiles');
  const r = await page.evaluate(() => window.runToneTiles!());
  console.log(`tiles ${r.tiles}: warm max ${r.warm}, cold max ${r.cold}`);
  expect(r.tiles).toBe(6 * 2);
  expect(r.warm).toBeLessThanOrEqual(1);
  expect(r.cold).toBeLessThanOrEqual(1);
});
```
Append to `tests/e2e/tone.spec.ts`:
```ts
/** the darkest 5 × 5-mean luma position within `rad` of (cx, cy), screenshot px */
function darkest(p: Pixels, cx: number, cy: number, rad: number): [number, number] {
  let best = Infinity;
  let at: [number, number] = [cx, cy];
  for (let y = Math.round(cy - rad); y <= Math.round(cy + rad); y += 2)
    for (let x = Math.round(cx - rad); x <= Math.round(cx + rad); x += 2) {
      let s = 0;
      for (let j = -2; j <= 2; j++)
        for (let i = -2; i <= 2; i++) {
          const k = ((y + j) * p.width + (x + i)) * 4;
          s += 0.299 * p.data[k] + 0.587 * p.data[k + 1] + 0.114 * p.data[k + 2];
        }
      if (s < best) {
        best = s;
        at = [x + 0.5, y + 0.5];
      }
    }
  return at;
}

test('spots stay on their content under 瘦臉 + 大眼, after 旋轉 and after 翻轉', async ({ page }) => {
  const fx = fixture();
  const dot = defect(fx, 'dot3');
  const rPx = 0.03 * fx.fw;
  await importPhoto(page, TONE_PNG);
  await plain(page);
  for (const name of ['瘦臉', '大眼']) {
    await pick(page, '美型', name);
    await dragSlider(page, 400);
  }
  const o: [number, number] = [dot.center[0] / fx.width, dot.center[1] / fx.height];
  const steps: { label: string; act?: string; map(p: [number, number]): [number, number] }[] = [
    { label: 'warped', map: (p) => p },
    { label: '旋轉', act: '旋轉', map: (p) => [p[1], 1 - p[0]] }, // 90° counter-clockwise
    { label: '旋轉 + 翻轉', act: '翻轉', map: (p) => [1 - p[1], 1 - p[0]] },
  ];
  for (const s of steps) {
    if (s.act) {
      await page.getByRole('tab', { name: '裁切' }).click();
      await option(page, s.act).click();
    }
    await pick(page, '美膚', '祛痘');
    const shot = await settled(frame(page));
    const scale = Math.max(shot.width, shot.height) / Math.max(fx.width, fx.height);
    const guess = s.map(o);
    const at = darkest(shot, guess[0] * shot.width, guess[1] * shot.height, 40 * scale);
    const b = (await frame(page).boundingBox())!;
    await page.mouse.click(b.x + (at[0] / shot.width) * b.width, b.y + (at[1] / shot.height) * b.height);
    await expect.poll(async () => (await debugState(page)).spots).toBe(1);
    const spot = (await debugState(page)).lastSpot!;
    const off = Math.hypot(spot.x * fx.width - dot.center[0], spot.y * fx.height - dot.center[1]);
    console.log(`${s.label}: lastSpot ${off.toFixed(1)} px from the dot (r ${rPx.toFixed(1)} px)`);
    expect(off, s.label).toBeLessThanOrEqual(0.3 * rPx);
    const healed = await settled(frame(page));
    expect(discSd(healed, at[0], at[1], 6 * scale), s.label).toBeLessThanOrEqual(0.6 * discSd(shot, at[0], at[1], 6 * scale));
    await page.getByRole('button', { name: '復原' }).click();
    await expect.poll(async () => (await debugState(page)).spots).toBe(0);
  }
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/media/exportPlan.test.ts`
Expected: FAIL — `spotWindowGrowth is not a function` (and `spotBounds`).
Run: `npm run build && npx playwright test tests/e2e/tone-engine.spec.ts -g tiles`
Expected: FAIL — the page does not compile (`spotWindowGrowth` missing); once it does, `cold` exceeds 1 (the tile engine has no field: Task 11's warning path).

- [ ] **Step 3: Implement**

`src/media/exportPlan.ts` (step 3's module; add `Spot`, `StillFrame` to its `../types` type import — `Rect` and `Size` are there already):
```ts
import { toneActive, toneValuesOf } from '../engine/passes/toneGeometry';

/**
 * Grow a tile's O-normalized source window so every spot whose quad (1.1 r) meets it also brings in its ring and donor
 * boxes, bbox(c ± 1.4 r) ∪ bbox(c + d ± 1.4 r) (skin-cleanup spec §4.6, A5); repeated until no further spot is met.
 * The heal then runs per tile on the tile's own pixels. `oSize` is any size with the O aspect: r and d are fractions of
 * its short side, and one of its pixels is the margin for the bilinear ring taps (the working size: ≥ 1 decode px).
 * Clipped to the photo; step 3's planner snaps the result outward to the decode grid.
 */
export function spotWindowGrowth(winO: Rect, spots: readonly Spot[], oSize: Size): Rect {
  const W = oSize.width;
  const H = oSize.height;
  const short = Math.min(W, H);
  let x0 = winO.x * W;
  let y0 = winO.y * H;
  let x1 = (winO.x + winO.w) * W;
  let y1 = (winO.y + winO.h) * H;
  const used = new Set<number>();
  let grew = true;
  while (grew) {
    grew = false;
    spots.forEach((s, i) => {
      if (used.has(i)) return;
      const cx = s.x * W;
      const cy = s.y * H;
      const r = s.r * short;
      const q = 1.1 * r;
      if (cx + q <= x0 || cx - q >= x1 || cy + q <= y0 || cy - q >= y1) return;
      used.add(i);
      const e = 1.4 * r + 1; // + 1 px for the bilinear ring taps
      const dx = s.dx * short;
      const dy = s.dy * short;
      const nx0 = Math.min(x0, cx - e, cx + dx - e);
      const ny0 = Math.min(y0, cy - e, cy + dy - e);
      const nx1 = Math.max(x1, cx + e, cx + dx + e);
      const ny1 = Math.max(y1, cy + e, cy + dy + e);
      if (nx0 < x0 || ny0 < y0 || nx1 > x1 || ny1 > y1) grew = true;
      x0 = nx0;
      y0 = ny0;
      x1 = nx1;
      y1 = ny1;
    });
  }
  if (used.size === 0) return winO;
  const cx0 = Math.max(0, x0);
  const cy0 = Math.max(0, y0);
  const cx1 = Math.min(W, x1);
  const cy1 = Math.min(H, y1);
  return { x: cx0 / W, y: cy0 / H, w: (cx1 - cx0) / W, h: (cy1 - cy0) / H };
}

/** a step-4 pass runs in the export: spots, or a drawn face with a tone item */
export function step4Active(frame: Pick<StillFrame, 'faces' | 'photo'>): boolean {
  return frame.photo.spots.length > 0 || frame.faces.some((f) => f.weight > 0 && toneActive(toneValuesOf(f.person.values)));
}

/** step 4's values for step 3's planner hooks (crop spec §4.4 steps 1 and 4): B at window size while a step-4 pass runs; spot windows */
export function spotBounds(frame: Pick<StillFrame, 'faces' | 'photo'>, oSize: Size): Pick<TileBounds, 'spotWindowGrowth' | 'oSpacePasses'> {
  const spots = frame.photo.spots;
  return {
    oSpacePasses: step4Active(frame),
    ...(spots.length ? { spotWindowGrowth: (winO: Rect) => spotWindowGrowth(winO, spots, oSize) } : {}),
  };
}
```
(`toneValuesOf` takes the person's values record and `toneActive` its result, as in Task 11's `buildToneJob`.)

`src/app/still.ts` (step 3's `StillSession`, step-3 plan Task 11): `bounds(f, b)` (`still.ts:367-369`) returns `{ body: b === undefined ? body : b, faces: faceBoundsFor(f.faces, width / height), ...spotBounds(f, { width, height }) }` (add `spotBounds` to the `../media/exportPlan` import, `still.ts:9`), and `tileInput(f, b)` (`still.ts:359-366`) adds the working image to its result, so every tile carries it (crop spec §4.4 runner):
```ts
      return { ...(all as TileInputBase), geometry: f.geometry ?? IDENTITY_GEOMETRY, oAspect: width / height, toneSource: { source: bitmap, width, height } };
```
(`bitmap`, `width`, `height` are the session's working bitmap and size, `still.ts:138-143`.)

`src/engine/pipeline.ts` — the `Pipeline` interface and the returned object gain:
```ts
  /** step 4 (tiles): the cached tone field is the one for `key` */
  toneFieldReady(key: string): boolean;
  /**
   * step 4 (tiles, skin-cleanup spec §4.6): build the tone field of `tj` from `src`, the working image (RenderInput.toneSource)
   * uploaded at tj.work — heal into A at that size when there are spots, then R, Q and P0c — so the tile's frame finds it.
   */
  prepareToneField(tj: ToneJob, src: Texture): void;
```
```ts
    toneFieldReady(key) {
      return toneKey === key && toneTex !== null;
    },

    prepareToneField(tj, src) {
      if (!tj.mn8On || (toneKey === tj.key && toneTex)) return;
      resetState();
      let base0: Texture = src;
      if (tj.spots.length > 0) {
        heal ??= createHealPass(gl);
        const a = fb('A', tj.work);
        heal.draw(src, a, fb('RING', { width: HEAL_RING_SAMPLES, height: tj.spots.length }), tj.spots, IDENTITY_WIN, tj.work);
        base0 = a.tex;
      }
      toneMask ??= createToneMaskPass(gl);
      const r = fb('R', maskBufferSize(tj.work));
      toneMask.draw(r, tj.drawsR, IDENTITY_WIN, R_CLEAR);
      buildToneField(tj, base0, r.tex);
      resetState();
    },
```
`src/engine/index.ts`, in step 3's `renderTile(input, read)` (`index.ts:431-447`; today `uploadSource(gl, srcTex, input.source, …)` then `const res = pipeline.run(job(input, srcTex, size, false, 'fbo', false));`): move its `job(…)` call (the FrameJob of the tile, called `j` here) above the upload of the tile's source, and put the field preparation between them:
```ts
      const ts = input.toneSource;
      if (j.tone && j.tone.mn8On && ts && !pipeline.toneFieldReady(j.tone.key)) {
        uploadSource(gl, srcTex, ts.source, ts.width, ts.height);
        pipeline.prepareToneField(j.tone, srcTex);
      }
      uploadSource(gl, srcTex, input.source, input.width, input.height);
      const res = pipeline.run(j);
```
(`job()` reads no texture content, so building it before the uploads is safe; keep the rest of `renderTile` — the read-back of `read` — as step 3 wrote it.)

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/media src/app && npm run typecheck`
Expected: PASS.
Run: `npm run build && npx playwright test tests/e2e/tone-engine.spec.ts tests/e2e/tone.spec.ts tests/e2e/crop.spec.ts tests/e2e/export.spec.ts`
Expected: all pass; the log prints `tiles 12: warm max ≤ 1, cold max ≤ 1` and each geometry step's `lastSpot … px from the dot`; step 3's tile harness (`export.spec.ts`, which has no spots or tone) still prints max channel diff ≤ 1 per case after the `renderTile` change.

- [ ] **Step 5: Commit**

```bash
git add src/engine/pipeline.ts src/engine/index.ts src/app/still.ts src/media/exportPlan.ts src/media/exportPlan.test.ts tests/e2e/pages/tone.ts tests/e2e/tone-engine.spec.ts tests/e2e/tone.spec.ts
git commit -m "v0.4 step 4 (18/20): tiled export with toneSource and spot windows; spots follow the geometry" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: The 膚質 bench rows

**Files:**
- Create: `src/bench/toneBench.ts`, `src/bench/toneBench.test.ts`
- Modify: `src/bench/main.ts` (CRLF; the `toneBtn` next to `bodyBtn` `:228` and in the panel row `:269`; a 「膚質量測」 section after the 美體 bench functions `runBodyBench` / `renderBodyTable` / `measureBody` `:606-763`; the copy-results report, `copyResults` `:781-784`)

**Interfaces:**
- Consumes: `Engine.renderToImageData` (`types.ts:549`), `RenderInput` (steps 1–3; the view is `RenderInput.geometry`, which the engine reads, `index.ts:287`), Task 13 `planSpot`, `spotRadius`, `patchPlan`, `readPatch`; step 1's `Tracker.detectImage(image, { maxFaces })`, `adapt`; `importPhoto` (`src/media/importer.ts`).
- Produces:
  ```ts
  export interface ToneBenchRow { row: string; ms: number; delta: number | null }
  export interface ToneBenchCase { row: string; input(i: number): RenderInput }
  export const TONE_BENCH_WARMUP: number;   // 3
  export const TONE_BENCH_RUNS: number;     // 10
  export function median(xs: readonly number[]): number;
  export function spotGrid(n: number, box: { x: number; y: number; w: number; h: number }): Spot[];
  export function withDeltas(rows: readonly { row: string; ms: number }[], base: string): ToneBenchRow[];
  export function formatToneBench(rows: readonly ToneBenchRow[]): string;   // TSV with a header
  export function runToneBench(engine: Engine, cases: readonly ToneBenchCase[], base: string, pause: () => Promise<void>): Promise<ToneBenchRow[]>;
  ```
  Rows (S §6): `frame (no 膚質)` (the base), `+ every tone tool, field cached`, `+ field rebuild every frame (勻膚 0.50 ↔ 0.51)`, `+ P0d only (白牙 + 亮眼)`, `+ 20 spots`, `+ 100 spots`, `tone + 20 spots, identity`, `tone + 20 spots, 3:4 crop + 旋轉`; plus `planSpot CPU, median of 20 taps`. Desktop now; the iPhone run needs the user's go-ahead for a preview deploy (C §6.2.3). The Web Inspector memory timeline over 10 s of a 瘦臉 drag is a manual step on the device.

- [ ] **Step 1: Write the failing test**

Create `src/bench/toneBench.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { formatToneBench, median, spotGrid, withDeltas } from './toneBench';

describe('toneBench helpers', () => {
  it('median', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('spotGrid: n spots inside the box, each with a donor of 3 radii to the right', () => {
    const s = spotGrid(20, { x: 0.3, y: 0.4, w: 0.4, h: 0.2 });
    expect(s).toHaveLength(20);
    for (const p of s) {
      expect(p.x).toBeGreaterThanOrEqual(0.3);
      expect(p.x).toBeLessThanOrEqual(0.7);
      expect(p.y).toBeGreaterThanOrEqual(0.4);
      expect(p.y).toBeLessThanOrEqual(0.6);
      expect(p.dx).toBeCloseTo(3 * p.r, 12);
      expect(p.owner).toBeNull();
    }
  });

  it('deltas against the base row, and a TSV report', () => {
    const rows = withDeltas([{ row: 'base', ms: 10 }, { row: '+ tone', ms: 12.5 }], 'base');
    expect(rows).toEqual([
      { row: 'base', ms: 10, delta: null },
      { row: '+ tone', ms: 12.5, delta: 2.5 },
    ]);
    expect(formatToneBench(rows)).toBe('row\tms\tΔ ms\nbase\t10.00\t\n+ tone\t12.50\t2.50');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/bench/toneBench.test.ts`
Expected: FAIL — `Failed to resolve import "./toneBench"`.

- [ ] **Step 3: Implement**

Create `src/bench/toneBench.ts`:
```ts
// 膚質 bench rows (skin-cleanup spec §6): whole-frame render + readback times (renderToImageData) with and without each
// step-4 pass, so the difference to the base row is the pass cost; one readback per frame keeps the GPU from queueing.
import type { Engine, RenderInput, Spot } from '../types';

export interface ToneBenchRow {
  row: string;
  ms: number;
  delta: number | null;
}
export interface ToneBenchCase {
  row: string;
  /** the input of run i (the rebuild row alternates a value per run) */
  input(i: number): RenderInput;
}

export const TONE_BENCH_WARMUP = 3;
export const TONE_BENCH_RUNS = 10;

export function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** n spots on a grid inside `box` (normalized O), r = 0.012, each with a donor 3 r to its right */
export function spotGrid(n: number, box: { x: number; y: number; w: number; h: number }): Spot[] {
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const r = 0.012;
  const out: Spot[] = [];
  for (let i = 0; i < n; i++) {
    const cx = box.x + ((i % cols) + 0.5) * (box.w / cols);
    const cy = box.y + (Math.floor(i / cols) + 0.5) * (box.h / rows);
    out.push({ x: cx, y: cy, r, dx: 3 * r, dy: 0, owner: null });
  }
  return out;
}

export function withDeltas(rows: readonly { row: string; ms: number }[], base: string): ToneBenchRow[] {
  const b = rows.find((r) => r.row === base)?.ms;
  return rows.map((r) => ({ row: r.row, ms: r.ms, delta: r.row === base || b === undefined ? null : r.ms - b }));
}

export function formatToneBench(rows: readonly ToneBenchRow[]): string {
  return ['row\tms\tΔ ms', ...rows.map((r) => `${r.row}\t${r.ms.toFixed(2)}\t${r.delta === null ? '' : r.delta.toFixed(2)}`)].join('\n');
}

export async function runToneBench(engine: Engine, cases: readonly ToneBenchCase[], base: string, pause: () => Promise<void>): Promise<ToneBenchRow[]> {
  const rows: { row: string; ms: number }[] = [];
  for (const c of cases) {
    const times: number[] = [];
    for (let i = 0; i < TONE_BENCH_WARMUP + TONE_BENCH_RUNS; i++) {
      const input = c.input(i);
      const t = performance.now();
      engine.renderToImageData(input, { mirror: false });
      if (i >= TONE_BENCH_WARMUP) times.push(performance.now() - t);
    }
    rows.push({ row: c.row, ms: median(times) });
    await pause();
  }
  return withDeltas(rows, base);
}
```
`src/bench/main.ts` — a third bench next to the 美體 one, following its pattern (`bodyInput`, `bodyTest`, `runBodyBench`, `main.ts:509-530`, `:606-639`):
```ts
// ───────────────────────── 膚質 ─────────────────────────

const toneOut = el('pre', { className: 'note' });
const toneInput = (() => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');
  input.style.cssText = 'position:fixed;left:-100px;top:0;width:1px;height:1px;opacity:0';
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    input.value = '';
    if (f) void runToneBenchUi(f);
  });
  root.appendChild(input);
  return input;
})();
let toneReport = '';

async function runToneBenchUi(file: File): Promise<void> {
  if (busy || !engine) return;
  busy = true;
  try {
    const bitmap = await importPhoto(file, 2048);
    const lms = tracker ? tracker.detectImage(bitmap, { maxFaces: 1 }) : [];
    if (!lms.length) throw new Error('沒有偵測到臉部');
    const face = adapt(lms[0], bitmap.width, bitmap.height);
    const photo = { ...defaultPhoto(), spots: [] as Spot[] };
    const person = (v: Partial<Record<ParamId, number>>) => ({ ...neutralPerson(), values: { ...neutralPerson().values, ...v } });
    const input = (v: Partial<Record<ParamId, number>>, spots: Spot[] = [], geometry?: Geometry): RenderInput => ({
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      faces: [{ face, weight: 1, person: person(v), protect: null }],
      obstacles: [],
      globalSkin: null,
      photo: { ...photo, spots, ...(geometry ? { geometry } : {}) },
      // the engine draws the view from RenderInput.geometry (as still.ts passes it), not from photo.geometry
      ...(geometry ? { geometry } : {}),
    });
    const all = { 'tone.even': 0.5, 'tone.warmth': 0.65, 'tone.darkCircle': 0.5, 'tone.nasolabial': 0.5, 'tone.teeth': 0.5, 'tone.eyeBright': 0.5 };
    const box = { x: 0.25, y: 0.3, w: 0.5, h: 0.4 };
    const s20 = spotGrid(20, box);
    const crop34 = rotateLeft(applyRatio(IDENTITY_GEOMETRY, '3:4', bitmap));
    const cases: ToneBenchCase[] = [
      { row: 'frame (no 膚質)', input: () => input({}) },
      { row: '+ every tone tool, field cached', input: () => input(all) },
      { row: '+ field rebuild every frame (勻膚 0.50 ↔ 0.51)', input: (i) => input({ ...all, 'tone.even': i % 2 ? 0.51 : 0.5 }) },
      { row: '+ P0d only (白牙 + 亮眼)', input: () => input({ 'tone.teeth': 0.5, 'tone.eyeBright': 0.5 }) },
      { row: '+ 20 spots', input: () => input({}, s20) },
      { row: '+ 100 spots', input: () => input({}, spotGrid(100, box)) },
      { row: 'tone + 20 spots, identity', input: () => input(all, s20) },
      { row: 'tone + 20 spots, 3:4 crop + 旋轉', input: () => input(all, s20, crop34) },
    ];
    toneOut.textContent = '量測中…';
    const rows = await runToneBench(engine, cases, 'frame (no 膚質)', nextPaint);
    const faces = [{ id: 'f0', face }];
    const work = { width: bitmap.width, height: bitmap.height };
    const plan: number[] = [];
    for (const s of s20) {
      const o: [number, number] = [s.x, s.y];
      const r = spotRadius(o, 'M', faces, work);
      const t = performance.now();
      planSpot(readPatch(bitmap, patchPlan(o, r, work)), o, r, { faces, aspect: work.width / work.height, existing: [] });
      plan.push(performance.now() - t);
    }
    rows.push({ row: 'planSpot CPU, median of 20 taps', ms: median(plan), delta: null });
    toneReport = formatToneBench(rows);
    toneOut.textContent = toneReport;
    bitmap.close();
  } catch (err) {
    showError('tone', err);
    toneOut.textContent = `失敗：${errText(err)}`;
  } finally {
    busy = false;
  }
}
```
Mount it (the bench needs the engine, so it lives in the panel shown after 開始, not on the start gate):
- next to `const bodyBtn = button('美體偵測', () => bodyTest());` (`main.ts:228`) add
  ```ts
  const toneBtn = button('膚質量測', () => toneTest());
  ```
- in the `panel` element (`main.ts:264-273`), the row `el('div', { className: 'row' }, delegateBtn, landmarksBtn, compareBtn, captureBtn, stillBtn, bodyBtn, exportBtn, exportPhotoBtn, resumeBtn)` (`:269`) gains `toneBtn` after `bodyBtn`;
- place the 膚質 section above after the 美體 bench functions (`main.ts:606-763`, so `nextPaint`, `:604`, is declared before it) and before `copyResults`; at its end, after `let toneReport = '';`:
  ```ts
  panel.append(toneOut);

  function toneTest(): void {
    if (busy || !engine) return;
    toneInput.click(); // synchronous inside the tap (iOS user-activation rule), as bodyTest
  }
  ```
- in `copyResults()` (`main.ts:781-784`), steps 1–3 build `const text = formatReport(reportMeta(), samples, bodyRows) + multiText + exportText;`; append the 膚質 part:
  ```ts
  const text = formatReport(reportMeta(), samples, bodyRows) + multiText + exportText + (toneReport ? `\n\n膚質\n${toneReport}` : '');
  ```

Imports: `adapt` from `../tracking/adapter111`; `defaultPhoto`, `neutralPerson` from `../edit/state`; `patchPlan`, `readPatch` from `../edit/patch`; `planSpot`, `spotRadius` from `../edit/spots`; `applyRatio`, `IDENTITY_GEOMETRY`, `rotateLeft` from `../geometry/view` (step 3's names; `applyRatio(g, lock, oSize)`, crop spec §3.3); `formatToneBench`, `runToneBench`, `spotGrid`, `type ToneBenchCase` from `./toneBench` (not `median`: `main.ts` already imports an equal `median` from `./report`, `:45`, and uses it here); `type Geometry`, `type ParamId`, `type RenderInput`, `type Spot` added to the `../types` type import (`:22-31`). `tracker`, `engine`, `busy`, `nextPaint`, `showError`, `errText`, `el`, `button`, `root`, `panel` are main.ts's own.

- [ ] **Step 4: Run the tests and build the bench page**

Run: `npx vitest run src/bench && npm run typecheck && npm run build`
Expected: PASS; the build includes `bench.html`.

- [ ] **Step 5: Commit**

```bash
git add src/bench/toneBench.ts src/bench/toneBench.test.ts src/bench/main.ts
git commit -m "v0.4 step 4 (19/20): 膚質 bench rows" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 20: Step gate — full suite and the v0.3-equivalence checks

**Files:**
- No source change expected. A fix found here goes into the task that owns the code, with its own test, and this gate runs again from Step 1.

**Interfaces:**
- Consumes: everything above; `.superpowers/step4-base.txt` and `.superpowers/step4-eol-before.txt` from Task 1.
- Produces: a green step 4 on `feat/meiyan-pwa`, version still 0.3.0, nothing pushed.

- [ ] **Step 1: Typecheck and unit tests**

Run: `npm run typecheck && npm test`
Expected: typecheck prints nothing; Vitest ends with every file passed (including `toneGeometry`, `toneCpu`, `toneCalibration`, `healCpu`, `toneJob`, `spots`, `patch`, `zoomPan`, `panelModel`, `exportPlan`, `toneBench`, `tests/unit/toneFixture`).

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: `tsc` and `vite build` succeed.

- [ ] **Step 3: The whole e2e suite**

Run: `npm run test:e2e`
Expected: every spec passes — the existing ones unchanged (`editor`, `engine`, `reshape`, `faceProtect`, `body`, `camera`, `home`, `settings`, `update`, `bench`, and steps 1–3's `parity`, `persons`, `camera-group` (its own `chromium-group` project), `adjust`, `composite`, `crop`, `export`), plus `tone-engine.spec.ts` and `tone.spec.ts`.

- [ ] **Step 4: v0.3 equivalence (C §1.1, S §4.1)**

Run:
```bash
npx playwright test tests/e2e/parity.spec.ts
npx vitest run src/engine/toneJob.test.ts -t "neutral tone and no spots"
base=$(cat .superpowers/step4-base.txt)
git diff --stat "$base" -- src/engine/shaders/composite.ts src/engine/passes/reshape.ts src/engine/passes/reshapeCpu.ts
git diff "$base" --name-only -- tests/e2e | grep -v -E '^tests/e2e/(tone\.spec\.ts|tone-engine\.spec\.ts|pages/tone\.(html|ts)|global-setup\.ts)$' || true
```
Expected:
- `parity.spec.ts` passes: a one-person photo with v0.3 items only is within 1/255 of v0.3 (max) and < 0.02/255 (mean);
- the `toneJob` test passes: neutral tone and no spots build no step-4 job, so the frame is step 3's, pass for pass (`tone-engine.spec.ts` also asserts the neutral frame lists none of `heal`, `toneField`, `retouch`);
- the `git diff --stat` prints nothing: `COMPOSITE_FS` (both variants) and `RESHAPE_FS` and its port are untouched by step 4;
- the last command prints nothing: no existing e2e spec changed.

- [ ] **Step 5: Unit-test assertions changed only where planned**

Run:
```bash
git diff "$(cat .superpowers/step4-base.txt)" -U0 -- 'src/**/*.test.ts' 'src/**/*.test.tsx' | grep -E '^-[^-]' || true
```
Expected: the removed lines are only the ones this plan changes on purpose — the `PARAM_DEFS` count, `GROUPS`, `BIDIRECTIONAL` and defaults table in `params.test.ts` (Task 1), step 1's scope-table person list and its `live` case in `state.test.ts` (Task 1), the 500-random round trip's `values:` line in `legacy.test.ts` (Task 3), import declarations that gained names (`legacy.test.ts`, `pipeline.test.ts`, `Slider.test.tsx`, `exportPlan.test.ts`, …), and — only if step 1's 美膚 strip test lists the whole strip with an editor context — that expected list (Task 16). Anything else is a regression to fix in its task.

- [ ] **Step 6: Line endings, version, nothing pushed**

Run:
```bash
git ls-files --eol > .superpowers/step4-eol-after.txt
join -j 2 <(awk '{print $2, $NF}' .superpowers/step4-eol-before.txt | sort -k2) <(awk '{print $2, $NF}' .superpowers/step4-eol-after.txt | sort -k2) | awk '$2 != $3'
node -p "require('./package.json').version"
git status --short
git log --oneline "$(cat .superpowers/step4-base.txt)"..HEAD
git status -sb | head -1
```
Expected:
- the `join` prints nothing: every file that existed before step 4 keeps its working-tree ending (`w/crlf` stays `w/crlf`);
- the version prints `0.3.0`;
- `git status --short` prints nothing (everything committed; the generated `sample_face_tone.*` are ignored);
- the log lists the step-4 task commits (`v0.4 step 4 task 1` … `task 19`, plus any `task <N> fix` commits; the base file holds the reconcile commit, so it is not listed);
- the branch line shows only local commits ahead (if the branch tracks a remote) — nothing was pushed.

- [ ] **Step 7: Record the gate**

```bash
git commit --allow-empty -m "v0.4 step 4 (20/20): step gate — typecheck, unit, build, full e2e, parity, pins, line endings" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
(As everywhere in this plan, the workflow's message format replaces this block: `v0.4 step 4 task 20: Step 4 gate`, written to a file and committed with `git commit --allow-empty -F`.)


---

## Spec coverage

| Spec section | Tasks |
|---|---|
| S §1.1 the seven tools; §1.2 rules (per person, non-destructive, editor only, works with everything, export) | 1, 3, 11, 14, 16, 17, 18 |
| S §1.3 build order 4a–4f | 4a = 1–3 · 4b = 4–6 · 4c = 7–11 · 4d = 12, 14 · 4e = 13, 15–17 · 4f = 18–19 |
| S §2.1 strip, divider, icons, dots, ⊘ | 3 (⊘), 16 (tone items), 17 (祛痘) |
| S §2.2 sliders, 冷／暖 ends, notes | 16 |
| S §2.3 祛痘 mode (entering, layout, canvas input, feedback, snap, size, refusals, cap, clear) | 13, 15, 17 |
| S §2.4 copy | 3 (`toneCopy.ts`), 16, 17 |
| S §3.1–3.2 params and types | 1, 3, 17 |
| S §3.3 pure modules (`limits`, `spots`, `patch`, `toneGeometry`) | 1, 2, 4, 5, 13 |
| S §3.4 tap → spot; §3.5 `planSpot` | 13, 17 |
| S §3.6 lens and panel | 3, 16, 17 |
| S §4.1 pass order and A/B ping-pong | 10, 11, 14 |
| S §4.2 region masks R and Q | 4, 5, 6 |
| S §4.3 tone field; §4.4 retouch | 8, 9, 11 |
| S §4.5 heal | 12, 14 |
| S §4.6 tiled export | 18 |
| S §4.7 GPU resources; §4.8 CPU ports and pins | 11, 12, 14 |
| S §5 persistence and migration | 2, 3 (`normalizeEntry` already hands the entry's O size to the sanitizer since step 3; Task 3 pins that spots survive a load) |
| S §6 bench rows | 19 |
| S §7 edge cases | 13 (fill mode, refusals, cap), 16 (no face, 基本模式, tracker states), 17 (`readPatch` throws, `pointercancel`, letterbox, 按住對比), 18 (geometry, tiles) |
| S §8.1 unit tests | 2, 3, 4, 5, 8, 11 (`toneJob`, shader pin), 12, 13, 15, 16, 17, 18 (`exportPlan`) |
| S §8.2 engine harness | 6, 9, 11, 14, 18 |
| S §8.3 fixture | 7 |
| S §8.4 app e2e | 16, 17, 18, 20 (parity) |

Deliberate deviations from the letter of S (each keeps the requirement's intent):
- S §4.3 Gaussian passes: direct texel taps with CPU-made weights instead of linear-sampled tap pairs, so `toneCpu` matches the GPU tap for tap (the buffers are ⅛ size or smaller).
- S §4.3/§4.5 encodings: the signed targets (Q.B, Δ8, RING) use 128/255 as zero instead of 0.5, so neutral decodes to exactly 0.
- S §4.4 colour spaces: the field uses Rec. 709 luma; the retouch (白牙, 亮眼) uses JPEG full-range YCbCr including its Y.
- S §4.5 robust weights: the second round recomputes σ as well as μ with the first weights (S names only μ), which keeps a line crossing the ring from dominating; the line test measures the mean error over the disc.
- S §8.2 case 1 "also asserts the targets on its output": the targets are asserted per tool by Task 9 on the CPU and by Task 11's engine case on the GPU at ⅔.
- S §8.4 case 1 measures each tool inside its own defect area (whole-face-box averages of 黑眼圈 / 法令紋 / 白牙 / 亮眼 are below 0.5 by construction); case 8's per-person box check uses 膚色 (visible across the whole face) instead of 黑眼圈 for the same isolation requirement.
- S §2.4 notes render in the strip's existing note slot (`StripBodyNote`), as the 美體 notes do.
- S §4.1 "`planPasses` gains `heal`, `toneField` and `retouch`": the decision lives in the pure `buildToneJob` (`src/engine/toneJob.ts`: `spots`, `fieldOn`, `mn8On`, `retouchOn`; null = none of them), which the pipeline reads as `FrameJob.tone`; `planPasses` is unchanged, so the v0.3 skip rules stay byte-identical. The unit test "neutral tone and no spots" and the engine harness's `passes` assertions pin the same behaviour.
- S §8.2 case 5 / C §8.4 "tile cases in step 3's export harness": the step-4 tile case runs in its own page (`tests/e2e/pages/tone.ts`, `runToneTiles`), because it needs the warm/cold engine pair for the `toneSource` rebuild and step 3's `export.spec.ts` asserts its exact case list; the planner hook wiring (`spotBounds` through `planTiles`) is pinned by Task 18's `exportPlan.test.ts` coverage case, and step 6's release-gate case in `export.ts` sets the step-4 inputs itself (step-6 plan).
- S §8.4 case 5 seeds the 100 spots by editing the saved record straight in IndexedDB from the page. Step 1's `seedHistory(page, record, files, typed?)` (`tests/e2e/fixtures.ts:199`) exists, but it writes a whole new record from local files, so the in-place edit stays.

Not implemented by this plan (conditional on later measurements): S §6 "Fallbacks if the iPhone numbers miss the budget" (`SPOT_CAP` 50, `HEAL_RING_SAMPLES` 24, the third O-size buffer `H`) and the on-device rows (iPhone via `/bench.html`, Web Inspector memory timeline) — they need a preview deploy the user has not approved; the bench rows and the one-line constants are in place for them.
