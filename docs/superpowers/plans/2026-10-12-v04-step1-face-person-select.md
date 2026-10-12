# v0.4 Step 1 選臉／選人 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single-face editor and camera into a per-person editor: up to 6 selectable faces and 4 bodies paired into persons, per-person 磨皮／紅潤／美型／美妝／局部美體, photo-level 美白／銳化／濾鏡／增高／長腿／背景保護, one N-face engine pass, a multi-person 美體 field, a cached detection in HistoryEntry v2, and a camera that tracks up to 3 faces with tap-to-select, 全部套用 and the hand-over to 編輯, while a one-person photo edited with v0.3 items renders within 1/255 of v0.3.

**Architecture:** Five sub-steps, each green on its own (spec §0.2): **1a** Phase 0 fixtures, parity goldens, GL probes and bench rows; **1b** the immutable `EditState` (photo layer + person layer), the lens that routes every panel read/write, `UndoStack {clone:false, key}` + `rebase`, HistoryEntry v2 and lazy migration, with every screen ported and behaviour unchanged (one implicit person `p0`, the engine still fed by `legacyProjection`); **1c** multi-face/multi-pose detection, `DetectionCache` + persons + pairing, the face-table reshape shader with summed, capped displacements, RGBA8 per-face skin mask, per-face makeup, per-face 瘦臉 limits and the multi-person body field, wired into the editor (UI still edits the primary); **1d** face boxes, person strip, 全部, per-tab notes, photo taps; **1e** camera tracks with MediaPipe's own One-Euro smoother replicated, tap-to-select, 全部套用 and the seed hand-over.

**Tech Stack:** Vite 8, TypeScript 5.9, Preact 10, WebGL2 (GLSL ES 3.00), MediaPipe tasks-vision 0.10.35 (FaceLandmarker, PoseLandmarker), Vitest 5 (`npm test`, node environment, fake-indexeddb), Playwright 1.63 Chromium (`npx playwright test <spec>`, `npm run test:e2e`), pngjs.

**Spec:** `docs/superpowers/specs/2026-10-12-face-person-select-design.md` (called **S** below) inside the contract `docs/superpowers/specs/2026-10-12-v04-roadmap.md` (called **RM**). Every §12 open question of RM is decided with its recommended default (RM §12 「決定（2026-10-12）」). Read both before starting; a task's requirements always include the sections it cites.

## Reconciliation (step 1)

Checked against the code at `496756c` (step 1 is the first v0.4 step: no earlier step is committed, `src/` and `tests/e2e/pages/` are unchanged since `892ea61`, and `npm run typecheck` is green there). Every file:line anchor, export and signature the tasks consume was verified; these edits were made:

- **Task 10:** `src/ui/components/HeightBandOverlay.test.tsx` (CRLF) calls `bandOrSuggested` with `BeautyParams` (`:121`, `:293`): it is ported with `editFromLegacy` in the same task (else the run and the typecheck of Step 6 fail). `Camera.tsx` has no `BeautyParams` / `EditState` type import today: the shim adds both.
- **Task 11:** `src/ui/update.ts` (LF) imports and calls `flushParams` (`:8, :90, :112`): renamed to `flushLook` with the state. `state.ts` keeps `BeautyParams` in its type import until Task 12 (`EditorSource.params` still uses it); `Camera.tsx` drops it once the shim goes.
- **Task 12:** `state.ts` and `flows.ts` drop their now-unused `BeautyParams` type import (`noUnusedLocals`).
- **Task 14:** the third `detectBody` test of `editorModel.test.ts` (`:260-264`) also passes a `BodyDetection` to `fakeBodyTracker`; `bodyTracker.fuzz.test.ts:232` reads `det.mask` (not only throw / `null`): both ported. The t7 fake keeps answering `null` for `pose=none`.
- **Task 20 Step 1:** `sed -i` would rewrite the CRLF `tests/harness/b2/harness.ts` to LF in Git Bash: the rename runs through a `node` one-liner that keeps every line ending.
- **Tasks 22, 23, 25 (CSS):** `--surface-2` and `--on-accent` are not tokens of `theme.css` (it has `--panel`, `--elevated`, `--accent-ink`, …) and `--dim` is a colour (`#4a4a4c`), so `opacity: var(--dim, 0.4)` would be invalid at computed-value time (no dimming): the rules use `var(--elevated)`, `opacity: 0.4` (as every existing dimmed control) and `var(--accent-ink)`. `.item-tile` clips (`overflow: hidden`), so the 「整張」 badge sits inside it. The 全部套用 chip's accent fill goes on its `> span` pill, like `.float-btn.held > span`.
- **Task 3 Step 11:** also records the S §3.4 T4 `ONE_EURO` source check in §6.4 (the spec asks sub-step 1a for it).
- **Commits:** the `git commit -m "v0.4 step 1a: …"` lines show each task's file list and intent; the workflow's own message format (`v0.4 step 1 task <N>: <title>`, written to a file and committed with `git commit -F`) replaces them.

## Global Constraints

- Branch `feat/meiyan-pwa`; commits are **local only**. Never `git push`, never deploy (that includes the preview deploy the iPhone bench needs: RM §1.2, S §6.2).
- `package.json` `"version"` stays `0.3.0` for the whole step (the 0.4.0 bump is step 6's release task).
- MediaPipe stays pinned at `0.10.35`; one FaceLandmarker instance (`tracker.ts:3-5`); everything on-device; CSP stays `connect-src 'self'`; no new runtime or dev dependency.
- Files keep their existing line endings. These working copies are **CRLF** and must stay CRLF (check any other file with `git ls-files --eol <path>` before editing; `w/crlf` = keep CRLF): `src/app/frameSource.ts`, `src/app/live.test.ts`, `src/app/live.ts`, `src/app/testFakes.ts`, `src/bench/main.ts`, `src/engine/assets.ts`, `src/engine/index.ts`, `src/engine/passes/makeup.test.ts`, `src/engine/passes/makeup.ts`, `src/engine/passes/mask.ts`, `src/engine/passes/reshape.test.ts`, `src/engine/pipeline.ts`, `src/tracking/tracker.ts`, `src/types.ts`, `src/ui/components/BeautyPanel.tsx`, `src/ui/components/EngineChip.tsx`, `src/ui/components/EngineStatus.tsx`, `src/ui/components/HeightBandOverlay.test.tsx`, `src/ui/components/HeightBandOverlay.tsx`, `src/ui/components/Slider.tsx`, `src/ui/deps.ts`, `src/ui/flows.ts`, `src/ui/format.ts`, `src/ui/panelModel.ts`, `src/ui/screens/Camera.tsx`, `src/ui/screens/Home.tsx`, `src/ui/screens/Review.tsx`, `src/ui/state.ts`, `src/ui/theme.css`, `src/ui/screens/zoomPan.ts`, `src/ui/app.tsx`, `src/ui/icons.tsx`, `src/engine/shaders/composite.ts`, `src/media/importer.ts`, `src/media/importer.test.ts`, `scripts/gen-luts.mjs`, `scripts/record-pose.mjs`, `tests/harness/b2/harness.ts`, `tests/harness/b4/main.tsx`, `tests/harness/b4/shoot.mjs`, `tests/harness/t2/main.ts`, `tests/harness/b3/tracker_e2e.mjs`, `tests/harness/t7/contextloss.mjs`, `tests/harness/t7/shoot.mjs`, `tests/harness/t8/run-bench2.mjs`. `tests/harness/t1/harness.ts` has mixed endings (`w/mixed`): keep each edited line's own ending. New files are LF. After editing a CRLF file, normalize it: `node -e "const f=process.argv[1];const fs=require('fs');fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace(/\r?\n/g,'\r\n'))" <file>`.
- Targeted e2e runs: the `chromium` project serves the **built** app (`vite preview` of `dist/`, `playwright.config.ts:49-54`; `global-setup.ts` only checks that `dist/` exists, not that it is fresh), and only the page harnesses under `tests/e2e/pages/` run on the dev server. So every targeted run of an app spec (`editor`, `camera`, `home`, `body`, `settings`, `bench`, `faceProtect`, `persons`, `camera-group`) is `npm run build && npx playwright test <specs>`; `npm run test:e2e` builds by itself (`pretest:e2e`). A stale `dist/` tests the previous task's code.
- `npm run typecheck` is `tsc --noEmit` over `src` **and** `tests` (`tsconfig.json:20`), harnesses included: every signature change ports `tests/harness/**` and `tests/e2e/pages/**` in the same commit. The gitignored, generated `tests/harness/b2/baseline/` is loaded at run time (`b2/harness.ts:16-21`) and is regenerated by `make-baseline.mjs`; if a stale copy on disk fails typecheck, delete the directory (`rm -rf tests/harness/b2/baseline`), never edit it.
- Single-person parity (RM §1.1, S §1.3): a photo with one person, edited with v0.3 items only, exports within **max 1/255 per channel and mean < 0.02/255** of the v0.3 goldens (`tests/fixtures/parity-v03/`, Task 2). `tests/e2e/parity.spec.ts` must pass after every task from Task 2 on.
- Existing tests keep their assertions. The only intended assertion changes of step 1 are S §8.5: `bodyTracker.test.ts:206-212` (`numPoses` 2 → 4), `bodyTracker.test.ts:185-194` (`toDetection` → `toDetections`), `panelModel.test.ts:264, 334` (`BODY_MULTI_NOTE` → bands note), `reshapeCpu.test.ts:32` (hash pin), `tests/e2e/camera.spec.ts:58-61` (poll `meiyan.look.v1`). Every other test change is a mechanical signature port in the same commit (`face` → `faces`, `BeautyParams` → `EditState` through the helpers each task names, `detectImage` returning an array, `measureSafe` taking the paired face).
- Limits (S §3.5), all in `src/config/limits.ts` and nowhere else: `MAX_EDIT_FACES = 6`, `EDIT_DETECT_FACES = MAX_EDIT_FACES + 2`, `MAX_RENDER_FACES = 6`, `MAX_EDIT_BODIES = 4`, `MAX_LIVE_FACES = 3`, `MIN_FACE_FRAC = 0.03`, `LOST_HOLD_MS = 1000`, `ONE_EURO = {minCutoff: 0.05, beta: 80, dCutoff: 1.0}`, `SEED_BOX_PAD = 0.25`, `PROTECT_WINDOW = 128`, `MAX_OBSTACLES = 8`. iPhone numbers are not available (no deploy): the defaults ship (RM §12 decision).
- Storage: IndexedDB `meiyan`, `DB_VERSION` 1, store `edits`, keyPath `id` unchanged (`history.ts:15-18`); every existing `meiyan.*` localStorage key unchanged; the only new keys are `meiyan.look.v1` and `meiyan.hint.persons.v1`. `HISTORY_LIMIT` stays 12. Undo depth stays 50; a selection change never pushes an undo step.
- Copy, verbatim (S §2.6, RM §2.6): 選擇人物 · 全部 · 人物 {n} · 人物 {n}（未偵測到臉部） · 人物 {n}（未偵測到身體） · 各人不同 · {label} · 整張照片 · 整張 · 整張照片 · {label}套用於整張照片 · 增高、長腿會拉伸整排畫面，套用於整張照片 · 長腿以人物 {n} 的腿長為準，套用於整張照片 · 這位人物未偵測到臉部，臉部效果不適用 · 這位人物未偵測到身體，僅能使用增高、長腿 · 已套用到全部人物 · 已復原人物 {n} 的變更 · 已重做人物 {n} 的變更 · 偵測到超過 {MAX} 張臉，只會美化最大的 {MAX} 張 · 有些臉太小，不會套用臉部效果 · 已重新偵測臉部，部分人物的設定已重設 · 點選臉部或下方人物，可個別調整 · 確定重置全部？ (≥ 2 persons) / 確定重置？ (one person) · 全部套用.
- Tabs stay the six of v0.3 (一鍵 · 美膚 · 美型 · 美體 · 濾鏡 · 美妝) in step 1. Chips are 44 × 44 pt, the person strip is 52 pt tall, face boxes are drawn (`pointer-events: none`), never buttons.
- Fixtures are synthesized from the Apache-2.0 images already in `tests/fixtures/` and recorded in `LICENSES/NOTICE.txt` with the Apache-2.0 §4(b) change notice (RM §8.3). `.y4m` files are generated and gitignored.

## Review Focus

1. **Two faces almost touching** (cheek-to-cheek selfie, a child on a lap: centres 0.3–0.5 face widths apart, box IoU below the 0.6 dedupe): both keep a finite, fold-free map (`min det J ≥ MIN_DET`, no NaN), and neither face's content is pulled into the other. Pinned in Task 16 (CPU-port case at 0.3 and 0.5 FW).
2. **A body-only person selected on a face tab** (美膚 opens on 磨皮, `INITIAL_SELECTION`; or a face-only person on a local 美體 item): the item is disabled with its reason and there is no slider — never a slider that shows a value but snaps back on every drag because the lens refuses the write. Pinned in Task 22 (`sliderFor` returns null for an item the selected person cannot use; photo items keep their slider).
3. **Camera face count flickering 1 ↔ 2 every few frames** (a second face at the frame edge): the beautified face never switches and the 全部套用 chip does not blink. Pinned in Task 24 (`FaceTracks` auto hysteresis under an alternating detection stream; `ChipGate` debounce).
4. **The camera tracker cannot answer for longer than `LOST_HOLD_MS`** (iOS drops the WebGL context when the app is backgrounded; the rebuild throttle; a replacement takes seconds): when answers resume, the tracks and a pinned selection are still there, even if a face is missed on the first frames back ("`lastSeen` does not age", S §3.4 T4). Pinned in Task 24 (a 3 s `null` stretch, then 500 ms without the pinned face).
5. **Extreme photo aspect** (an iPhone panorama 3:1, a 1:3 screenshot) with faces near the edges: caps, influence boxes and protect windows stay in iso units, no face loses its eyes to an aspect error. Pinned in Task 16 (`capsFor` / `capBox` at aspect 3 and 1/3).

Lower-likelihood inputs keep their tests as ordinary task tests: degenerate MediaPipe faces (Task 13, `prepareFaces` drops non-finite / collapsed faces) and records written by intermediate step-1 builds (Task 5 `sanitizeEditState` partial record, Task 8 `normalizeDetect` dangling links).

---

## File Structure

**New modules**

| File | Responsibility |
|---|---|
| `src/config/limits.ts` | Every number Phase 0 may change (S §3.5), plus `FACE_TABLE_CARRIER` and `LIVE_DETECT_FACES` |
| `src/engine/glProbe.ts` | GL limits (`readGlLimits`) and the PG1 / PG2 probes (S §6.2) |
| `src/bench/multiFace.ts` | Bench 「多臉」 section: rows D, B, GL and later R, BF, F, PE, L, J, J2 |
| `src/edit/state.ts` | `EditState` constructors, `editKey`, `assignPersons`, `renamePersons`, `resetAll`, `sanitizeEditState` and the person/photo sanitizers |
| `src/edit/legacy.ts` | `splitLegacy`, `legacyProjection`, `editFromLegacy` (v1 ↔ v2) |
| `src/edit/lens.ts` | `lensFor`: the one place that routes photo vs person and one person vs 全部 (RM §3.3) |
| `src/edit/migrate.ts` | `openState` (stored entry → state), `importEdit`, `cameraShotEdit`, `firstAnswer` (the first definite detection answer, A13) |
| `src/edit/frame.ts` | `buildFrame` (edit + faces → `StillFrame`), `legacyFrame` (v1 params + one face → frame, for tests/harnesses/bench) |
| `src/edit/warpGuard.ts` | The editor's fold safety net for summed face warps (S §4.4 last bullet): λ_f per capped face from the CPU port, on slider commits |
| `src/detect/faces.ts` | `prepareFaces`, `faceBox`, `boxIoU`, `personScore` |
| `src/detect/persons.ts` | `pairPersons`, `primaryOf`, `seedPrimary`, `hitPerson` |
| `src/detect/cache.ts` | `buildCache`, `withFaces`, `withBodies`, `cachedFits`, `normalizeDetect`, `rematchByIoU`, `personInfos`, `noFaceCache` |
| `src/engine/passes/faceCap.ts` | `capsFor`, `uMaxBox`, `packFaceTable` (S §4.1, §4.4) |
| `src/engine/passes/reshapeCpuV03.ts` | Test-only frozen copy of today's `reshapeCpu.ts` (bit-exact anchor) |
| `src/app/oneEuro.ts`, `src/app/faceTracks.ts` | Live smoothing, track matching, selection, `cameraTapAction`, seed mapping |
| `src/ui/components/PersonStrip.tsx`, `FaceBoxes.tsx`, `CameraFaceMarker.tsx` | S §2 |
| `scripts/gen-group-fixture.mjs`, `scripts/record-parity.mjs`, `scripts/bench-multiface.mjs` | Fixtures, goldens, desktop bench driver |
| `tests/e2e/pages/parity.{html,ts}`, `tests/e2e/parity.spec.ts`, `tests/e2e/persons.spec.ts`, `tests/e2e/camera-group.spec.ts` | E2E |

**Modified (main ones; each task lists exact anchors):** `src/types.ts`, `src/engine/params.ts`, `src/store/{undo,history,settings}.ts`, `src/tracking/{tracker,bodyTracker,faceProtect}.ts`, `src/engine/{index,pipeline,uniforms}.ts`, `src/engine/gl/gl.ts`, `src/engine/passes/{reshape,reshapeCpu,mask,makeup}.ts`, `src/engine/shaders/composite.ts`, `src/body/{field,measure}.ts`, `src/app/{still,live,testFakes,debug}.ts`, `src/ui/{state,flows,deps,editorModel,faceProtectModel,panelModel,debug}.ts`, `src/ui/screens/{Editor,Camera,Review,Home,zoomPan}.tsx|ts`, `src/ui/components/{BeautyPanel,Slider}.tsx`, `src/ui/theme.css`, `src/bench/{main,report}.ts`, `scripts/{gen-y4m,record-landmarks,record-pose}.mjs`, `playwright.config.ts`, `tests/e2e/{fixtures,global-setup,camera,body}.ts`, `LICENSES/NOTICE.txt`, `.gitignore`, `docs/superpowers/specs/2026-10-12-face-person-select-design.md` (§6.4 results only).

**Deliberate choices (inside the spec's freedom):**
- The v1 helpers (`applyPreset`, `setParam`, `sanitizeParams`, …) stay in `src/engine/params.ts`, where tests, harnesses and e2e pages import them; `src/edit/legacy.ts` builds on them (RM §3.8 says "move"; moving would only churn imports).
- Passes keep a one-face wrapper next to the N-face entry point (`ReshapePass.draw`, `MaskPass.draw`, `MakeupPass.draw`, `reshapeMapCpu`, `buildFaceProtect(face, mask, …)`, `FaceProtectSource.update(face, …)`, `buildBodyFieldV1`), so the harnesses, e2e pages and the existing unit tests run unchanged against the new code path.
- `reshapeCpu.ts`, test-only in v0.3, joins the app bundle (a few KB) for the S §4.4 editor fold safety net (`src/edit/warpGuard.ts`, Task 21): it runs only on a slider commit with ≥ 2 capped faces.

---

## Sub-step 1a — Phase 0

### Task 1: Group fixtures (images, landmark/pose JSON, y4m clips)

**Files:**
- Create: `scripts/gen-group-fixture.mjs`, `tests/harness/t5/group-fixtures.test.mjs`
- Modify: `scripts/gen-y4m.mjs:166-200` (helpers after `encodeY4m`, CLI `main()` `:173-198`), `scripts/record-landmarks.mjs:15-62,110-129`, `scripts/record-pose.mjs:16-51,101-125` (CRLF), `tests/e2e/global-setup.ts:10-16`, `.gitignore:14`, `LICENSES/NOTICE.txt:51-59`
- Generated + committed: `tests/fixtures/group_faces.png`, `group6_faces.png`, `group_people.jpg`, `group_faces.landmarks.json`, `group_faces.pose.json`, `group_people.pose.json`
- Generated, gitignored: `tests/fixtures/group.y4m`, `group_noise.y4m`, `group_pan.y4m`

**Interfaces:**
- Consumes: `resampleRgb`, `rgbToI420`, `encodeY4m`, `composeFrame`, `W`, `H`, `FRAMES` (`gen-y4m.mjs`); `downscaleMask`, `toPose33` (`src/tracking/bodyTracker.ts:186-228`).
- Produces: `GROUP_FACES`, `GROUP6` (exported constants of `gen-group-fixture.mjs`); `composeContain(png)`, `rng(seed)`, `shiftFrame(rgb, sx, sy, rand, amp)`, `encodeY4mFrames(planes[], w, h)` (exported from `gen-y4m.mjs`); fixture JSON shapes: `group_faces.landmarks.json` = `{source, width, height, tasksVision, model, delegate, numFaces, note, faces: number[][] /* 478×3 each */}`; `*.pose.json` (multi) = `{source, width, height, tasksVision, model, delegate, numPoses, note, poses: {points: number[] /* 132 */, mask: {width, height, data /* base64 */} | null}[]}`.

- [x] **Step 1: Write the failing fixture test**

```js
// tests/harness/t5/group-fixtures.test.mjs
// Step-1 group fixtures (scripts/gen-group-fixture.mjs, gen-y4m.mjs --src/--noise/--pan): sizes, the recorded
// multi-face / multi-pose JSON shapes, and the y4m frame helpers.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { composeContain, rng, shiftFrame } from '../../../scripts/gen-y4m.mjs';

const fx = (n) => join(import.meta.dirname, '..', '..', 'fixtures', n);

describe('group fixtures', () => {
  it('group_faces.png is 1800×1200 and group6_faces.png 2048×1536', () => {
    const a = PNG.sync.read(readFileSync(fx('group_faces.png')));
    expect([a.width, a.height]).toEqual([1800, 1200]);
    const b = PNG.sync.read(readFileSync(fx('group6_faces.png')));
    expect([b.width, b.height]).toEqual([2048, 1536]);
  });
  it('group_people.jpg exists and is a JPEG', () => {
    const buf = readFileSync(fx('group_people.jpg'));
    expect([buf[0], buf[1]]).toEqual([0xff, 0xd8]);
  });
  it('group_faces.landmarks.json holds ≥ 3 faces of 478 points; A, B and C are found (PD2)', () => {
    const j = JSON.parse(readFileSync(fx('group_faces.landmarks.json'), 'utf8'));
    expect(j.numFaces).toBe(8);
    expect(j.faces.length).toBeGreaterThanOrEqual(3);
    for (const f of j.faces) expect(f).toHaveLength(478 * 3);
    const centres = j.faces.map((f) => {
      let lo = 1;
      let hi = 0;
      for (let i = 0; i < 478; i++) {
        lo = Math.min(lo, f[i * 3]);
        hi = Math.max(hi, f[i * 3]);
      }
      return (lo + hi) / 2;
    });
    for (const cx of [0.22, 0.55, 0.82]) expect(centres.some((c) => Math.abs(c - cx) < 0.05), `face at x ${cx}`).toBe(true);
  });
  it('the multi-pose JSONs hold poses of 132 floats', () => {
    for (const n of ['group_faces.pose.json', 'group_people.pose.json']) {
      const j = JSON.parse(readFileSync(fx(n), 'utf8'));
      expect(j.numPoses).toBe(4);
      expect(j.poses.length).toBeGreaterThanOrEqual(n === 'group_people.pose.json' ? 2 : 1);
      for (const p of j.poses) expect(p.points).toHaveLength(132);
    }
  });
});

describe('gen-y4m helpers', () => {
  it('rng is deterministic and in [0, 1)', () => {
    const a = rng(7);
    const b = rng(7);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x >= 0 && x < 1).toBe(true);
    }
  });
  it('shiftFrame by (0, 0) without noise is the identity; a 1 px shift moves a column', () => {
    const w = 4;
    const h = 2;
    const rgb = new Float32Array(w * h * 3).map((_, i) => (i % 3 === 0 ? (Math.floor(i / 3) % w) * 10 : 0));
    expect(Array.from(shiftFrame(rgb, 0, 0, () => 0.5, 0, w, h))).toEqual(Array.from(rgb));
    const s = shiftFrame(rgb, 1, 0, () => 0.5, 0, w, h);
    expect(s[3 * 2]).toBeCloseTo(10); // x = 2 now shows source x = 1
  });
  it('composeContain fits a 1800×1200 source into 1280×720 with pillarboxes', () => {
    const png = new PNG({ width: 1800, height: 1200 });
    png.data.fill(200);
    const rgb = composeContain(png);
    expect(rgb.length).toBe(1280 * 720 * 3);
  });
  it('the generated clips exist once global-setup ran (skipped before)', () => {
    if (!existsSync(fx('group.y4m'))) return;
    const head = readFileSync(fx('group.y4m')).subarray(0, 40).toString('ascii');
    expect(head.startsWith('YUV4MPEG2 W1280 H720')).toBe(true);
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/harness/t5/group-fixtures.test.mjs`
Expected: FAIL (`ENOENT … group_faces.png` and `composeContain is not a function` / not exported).

- [x] **Step 3: Write `scripts/gen-group-fixture.mjs`**

```js
// Builds the step-1 group fixtures from Apache-2.0 images already in tests/fixtures (LICENSES/NOTICE.txt):
//   group_faces.png  1800×1200: four sample_face.png copies with their upper bodies, bottom-aligned on the source's
//                    edge colour: A scale 0.42 at x 0.22; B mirrored, 0.34 at x 0.55; C 0.22 at x 0.82; D 0.05 at the
//                    bottom right (its face is below MIN_FACE_FRAC: must be ignored)
//   group6_faces.png 2048×1536: six square cells of sample_face.png (1.3 face widths each) in a 3×2 grid, odd cells
//                    mirrored: faces 1.3 FW apart (clustered-cap bench and e2e)
//   group_people.jpg fullbody.jpg + fullbody_yoga.jpg side by side at equal height (1000 px), JPEG q 0.92
// Composed with canvas 2D in headless Chromium (Playwright), so it is deterministic for a given Chromium build.
//   node scripts/gen-group-fixture.mjs
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fx = (name) => join(root, 'tests', 'fixtures', name);
const dataUrl = (name, mime) => `data:${mime};base64,${readFileSync(fx(name)).toString('base64')}`;

/** sample_face.png is 1000×1500; x = copy centre (fraction of the width); copies are bottom-aligned */
export const GROUP_FACES = {
  width: 1800,
  height: 1200,
  copies: [
    { name: 'A', scale: 0.42, x: 0.22, mirror: false },
    { name: 'B', scale: 0.34, x: 0.55, mirror: true },
    { name: 'C', scale: 0.22, x: 0.82, mirror: false },
    { name: 'D', scale: 0.05, x: 0.975, mirror: false },
  ],
};

/**
 * sample_face.png's face (oval bbox of landmarks_sample_face.json): x 193–813, y 180–662 px, face width 619 px,
 * centre (503, 421)… the crop is a square of 805 px = 1.3 FW around the face midline, drawn into 644 px cells (0.8×).
 */
export const GROUP6 = { width: 2048, height: 1536, cell: 644, crop: { x: 100.5, y: 227.5, w: 805, h: 805 } };

/** Bundled Playwright chromium may be missing; fall back to the newest installed revision. */
async function launch() {
  try {
    return await chromium.launch();
  } catch (e) {
    const base = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
    const revs = existsSync(base) ? readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort() : [];
    for (const rev of revs.reverse()) {
      for (const exe of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome']) {
        const p = join(base, rev, exe);
        if (existsSync(p)) return chromium.launch({ executablePath: p });
      }
    }
    return chromium.launch({ channel: 'chrome' }).catch(() => {
      throw e;
    });
  }
}

const browser = await launch();
try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><meta charset="utf-8"><body></body>');
  const out = await page.evaluate(
    async ({ face, body, yoga, G, G6 }) => {
      const load = async (src) => {
        const i = new Image();
        i.src = src;
        await i.decode();
        return i;
      };
      const [F, Bd, Y] = await Promise.all([load(face), load(body), load(yoga)]);
      const canvas = (w, h) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const g = c.getContext('2d');
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        return [c, g];
      };
      // the source's edge colour: mean of its top-left 40×40 block
      const [, pg] = canvas(40, 40);
      pg.drawImage(F, 0, 0, 40, 40, 0, 0, 40, 40);
      const px = pg.getImageData(0, 0, 40, 40).data;
      const mean = [0, 1, 2].map((k) => {
        let s = 0;
        for (let i = k; i < px.length; i += 4) s += px[i];
        return Math.round(s / (px.length / 4));
      });
      const fill = `rgb(${mean.join(',')})`;
      const draw = (g, img, sx, sy, sw, sh, dx, dy, dw, dh, mirror) => {
        g.save();
        if (mirror) {
          g.translate(dx + dw, dy);
          g.scale(-1, 1);
          g.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
        } else g.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
        g.restore();
      };

      const [c1, g1] = canvas(G.width, G.height);
      g1.fillStyle = fill;
      g1.fillRect(0, 0, G.width, G.height);
      for (const k of G.copies) {
        const w = Math.round(F.naturalWidth * k.scale);
        const h = Math.round(F.naturalHeight * k.scale);
        draw(g1, F, 0, 0, F.naturalWidth, F.naturalHeight, Math.round(k.x * G.width - w / 2), G.height - h, w, h, k.mirror);
      }

      const [c2, g2] = canvas(G6.width, G6.height);
      g2.fillStyle = fill;
      g2.fillRect(0, 0, G6.width, G6.height);
      const x0 = Math.round((G6.width - 3 * G6.cell) / 2);
      const y0 = Math.round((G6.height - 2 * G6.cell) / 2);
      for (let i = 0; i < 6; i++) {
        const cx = x0 + (i % 3) * G6.cell;
        const cy = y0 + Math.floor(i / 3) * G6.cell;
        draw(g2, F, G6.crop.x, G6.crop.y, G6.crop.w, G6.crop.h, cx, cy, G6.cell, G6.cell, i % 2 === 1);
      }

      const yw = Math.round((Y.naturalWidth * Bd.naturalHeight) / Y.naturalHeight);
      const [c3, g3] = canvas(Bd.naturalWidth + yw, Bd.naturalHeight);
      g3.drawImage(Bd, 0, 0);
      g3.drawImage(Y, 0, 0, Y.naturalWidth, Y.naturalHeight, Bd.naturalWidth, 0, yw, Bd.naturalHeight);
      return { faces: c1.toDataURL('image/png'), six: c2.toDataURL('image/png'), people: c3.toDataURL('image/jpeg', 0.92) };
    },
    {
      face: dataUrl('sample_face.png', 'image/png'),
      body: dataUrl('fullbody.jpg', 'image/jpeg'),
      yoga: dataUrl('fullbody_yoga.jpg', 'image/jpeg'),
      G: GROUP_FACES,
      G6: GROUP6,
    },
  );
  const write = (name, url) => {
    writeFileSync(fx(name), Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    console.log(`wrote tests/fixtures/${name}`);
  };
  write('group_faces.png', out.faces);
  write('group6_faces.png', out.six);
  write('group_people.jpg', out.people);
} finally {
  await browser.close();
}
```

- [x] **Step 4: Extend `scripts/gen-y4m.mjs` (CLI `--src --out --noise --pan --fw --frames`)**

Add these exports after `encodeY4m` (`gen-y4m.mjs:166-171`) and replace `main()` (`gen-y4m.mjs:173-198`; keep the `if (process.argv[1] && …) main();` guard of `:200`, which lets the unit test import the helpers without running the CLI). With no flags the output is byte-identical to today's `face.y4m` (same `composeFrame`, same `encodeY4m`).

```js
/** Fit `png` inside W×H ("contain"), centred, on its top-left pixel's colour (any source other than sample_face). */
export function composeContain(png) {
  const s = Math.min(W / png.width, H / png.height);
  const dw = Math.round(png.width * s);
  const dh = Math.round(png.height * s);
  const img = resampleRgb(png.data, png.width, png.height, { x: 0, y: 0, w: png.width, h: png.height }, dw, dh);
  const fill = [png.data[0], png.data[1], png.data[2]];
  const left = Math.round((W - dw) / 2);
  const top = Math.round((H - dh) / 2);
  const rgb = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 3;
      const cx = x - left;
      const cy = y - top;
      const inside = cx >= 0 && cx < dw && cy >= 0 && cy < dh;
      const i = (cy * dw + cx) * 3;
      rgb[o] = inside ? img[i] : fill[0];
      rgb[o + 1] = inside ? img[i + 1] : fill[1];
      rgb[o + 2] = inside ? img[i + 2] : fill[2];
    }
  }
  return rgb;
}

/** mulberry32: a deterministic PRNG in [0, 1) */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `rgb` (w×h) shifted by (sx, sy) px (bilinear, edge clamp) plus uniform noise of ±amp levels drawn from `rand`. */
export function shiftFrame(rgb, sx, sy, rand, amp, w = W, h = H) {
  const out = new Float32Array(w * h * 3);
  const at = (x, y, k) => rgb[(Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 3 + k];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const fx = x - sx;
      const fy = y - sy;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const ax = fx - x0;
      const ay = fy - y0;
      for (let k = 0; k < 3; k++) {
        const v =
          (at(x0, y0, k) * (1 - ax) + at(x0 + 1, y0, k) * ax) * (1 - ay) + (at(x0, y0 + 1, k) * (1 - ax) + at(x0 + 1, y0 + 1, k) * ax) * ay;
        out[(y * w + x) * 3 + k] = amp > 0 ? v + (rand() - 0.5) * 2 * amp : v;
      }
    }
  }
  return out;
}

/** A clip of distinct frames (each `{Y, U, V}`), 30 fps. */
export function encodeY4mFrames(planes, w, h) {
  const header = Buffer.from(`YUV4MPEG2 W${w} H${h} F30:1 Ip A1:1 C420jpeg\n`, 'ascii');
  const frameHeader = Buffer.from('FRAME\n', 'ascii');
  return Buffer.concat([header, ...planes.flatMap((p) => [frameHeader, p.Y, p.U, p.V])]);
}

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};

function main() {
  const srcRel = arg('--src', 'tests/fixtures/sample_face.png');
  const outRel = arg('--out', 'tests/fixtures/face.y4m');
  const noise = arg('--noise', null);
  const pan = arg('--pan', null);
  const src = PNG.sync.read(readFileSync(join(root, srcRel)));
  const base = srcRel.endsWith('sample_face.png') ? composeFrame(src) : composeContain(src);
  const out = join(root, outRel);
  mkdirSync(dirname(out), { recursive: true });
  let buf;
  if (noise === null && pan === null) {
    buf = encodeY4m(rgbToI420(base, W, H), W, H, FRAMES);
  } else {
    const n = Number(arg('--frames', '60'));
    // face width of group_faces.png's face A in the 1280×720 frame (0.42 × 619 px × 720/1200)
    const fwPx = Number(arg('--fw', '156'));
    const rand = rng(Number(noise ?? 1));
    const frames = [];
    for (let f = 0; f < n; f++) {
      const sx = pan !== null ? (Number(pan) * fwPx * f) / 30 : rand() - 0.5;
      const sy = pan !== null ? 0 : rand() - 0.5;
      frames.push(rgbToI420(shiftFrame(base, sx, sy, rand, noise !== null ? 2 : 0), W, H));
    }
    buf = encodeY4mFrames(frames, W, H);
  }
  writeFileSync(out, buf);
  console.log(`${outRel} ${W}x${H} (${(buf.length / 1e6).toFixed(1)} MB)`);

  // Optional RGB preview of the composed frame (for eyeballing / the fake-camera check).
  const previewArg = process.argv.indexOf('--preview');
  if (previewArg > 0 && process.argv[previewArg + 1]) {
    const png = new PNG({ width: W, height: H });
    for (let i = 0; i < W * H; i++) {
      png.data[i * 4] = clamp8(base[i * 3]);
      png.data[i * 4 + 1] = clamp8(base[i * 3 + 1]);
      png.data[i * 4 + 2] = clamp8(base[i * 3 + 2]);
      png.data[i * 4 + 3] = 255;
    }
    const p = process.argv[previewArg + 1];
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, PNG.sync.write(png));
    console.log(`preview -> ${p}`);
  }
}
```

- [x] **Step 5: Multi-face mode in `scripts/record-landmarks.mjs`**

1. After `outPath` (`:15`) add:

```js
const facesAt = process.argv.indexOf('--faces');
const numFaces = facesAt > 0 ? Number(process.argv[facesAt + 1]) : 1;
```

2. In `PAGE`, change `window.run = async (imgUrl) => {` to `window.run = async (imgUrl, numFaces) => {`, `numFaces: 1,` to `numFaces,`, and insert right after the `createFromOptions` call:

```js
  if (numFaces > 1) {
    const faces = lm.detect(img).faceLandmarks.map((f) => f.flatMap((p) => [p.x, p.y, p.z]));
    lm.close();
    return { width: img.naturalWidth, height: img.naturalHeight, faces };
  }
```

3. Replace `const result = await page.evaluate((u) => window.run(u), toUrl(imgPath));` (`:110`) with `const result = await page.evaluate(([u, n]) => window.run(u, n), [toUrl(imgPath), numFaces]);` and insert directly after it (so today's `points` / `mirrored` length check of `:111-113` moves into the single-face `else` branch):

```js
  if (numFaces > 1) {
    const round = (a) => a.map((v) => Math.round(v * 1e6) / 1e6);
    writeFileSync(
      outPath,
      JSON.stringify({
        source: relative(root, imgPath).split(sep).join('/'),
        width: result.width,
        height: result.height,
        tasksVision: '0.10.35',
        model: 'face_landmarker.task float16/1',
        delegate: 'CPU',
        numFaces,
        note: 'FaceLandmarker IMAGE mode, numFaces as given; faces = MediaPipe result order, each 478 x (x, y, z), unmirrored.',
        faces: result.faces.map(round),
      }) + '\n',
    );
    console.log(`wrote ${relative(root, outPath)} (${result.faces.length} faces)`);
  } else {
```

and close that `else {` after the existing single-face block's `console.log(...)` with `}`.

- [x] **Step 6: Multi-pose mode in `scripts/record-pose.mjs` (CRLF)**

1. After `variant` (`:16`) add `const posesAt = process.argv.indexOf('--poses'); const numPoses = posesAt > 0 ? Number(process.argv[posesAt + 1]) : 0;`.
2. Extend `PAGE`'s module script (keep the existing `window.run`) with:

```js
import { FilesetResolver, PoseLandmarker } from '/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs';
import { downscaleMask, toPose33 } from '/src/tracking/bodyTracker.ts';
window.runAll = async (imgUrl, variant, numPoses) => {
  const img = new Image();
  img.src = imgUrl;
  await img.decode();
  const model = new Uint8Array(await (await fetch(POSE_MODELS[variant])).arrayBuffer());
  const fileset = await FilesetResolver.forVisionTasks('/node_modules/@mediapipe/tasks-vision/wasm');
  // GPU + masks: the photo-editor graph (CPU + masks aborts in 0.10.35, bodyTracker.ts header)
  const lm = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetBuffer: model, delegate: 'GPU' },
    runningMode: 'IMAGE',
    numPoses,
    outputSegmentationMasks: true,
  });
  const r = lm.detect(img);
  const poses = r.landmarks.map((p, i) => {
    const m = r.segmentationMasks?.[i];
    const mask = m ? downscaleMask(m.getAsFloat32Array(), m.width, m.height) : null;
    let bin = '';
    if (mask) for (const b of mask.data) bin += String.fromCharCode(b);
    return { points: Array.from(toPose33(p)), mask: mask ? { width: mask.width, height: mask.height, data: btoa(bin) } : null };
  });
  r.close();
  lm.close();
  return { width: img.naturalWidth, height: img.naturalHeight, poses };
};
```

(the existing `import { createBodyTracker } …` and `import { POSE_MODELS } …` lines stay; `POSE_MODELS` is already imported there).

3. Before `const r = await page.evaluate(...)` (`:101`) add:

```js
  if (numPoses > 0) {
    const all = await page.evaluate(([u, v, n]) => window.runAll(u, v, n), [toUrl(imgPath), variant, numPoses]);
    const round = (a) => a.map((v) => Math.round(v * 1e6) / 1e6);
    writeFileSync(
      outPath,
      JSON.stringify({
        source: relative(root, imgPath).split(sep).join('/'),
        width: all.width,
        height: all.height,
        tasksVision: '0.10.35',
        model: `pose_landmarker_${variant}.task float16/1`,
        delegate: 'GPU',
        numPoses,
        note: 'PoseLandmarker IMAGE, every pose in result order; points = 33 x (x, y, z, visibility); mask = downscaleMask (256 long edge), base64.',
        poses: all.poses.map((p) => ({ points: round(p.points), mask: p.mask })),
      }) + '\n',
    );
    console.log(`wrote ${relative(root, outPath).split(sep).join('/')} (${all.poses.length} poses)`);
  } else {
```

and close the `else {` after the single-pose block's final `console.log(...)`.

- [x] **Step 7: Generate everything**

Run (one after the other):
```bash
node scripts/gen-group-fixture.mjs
node scripts/record-landmarks.mjs tests/fixtures/group_faces.png tests/fixtures/group_faces.landmarks.json --faces 8
node scripts/record-pose.mjs tests/fixtures/group_faces.png tests/fixtures/group_faces.pose.json full --poses 4
node scripts/record-pose.mjs tests/fixtures/group_people.jpg tests/fixtures/group_people.pose.json full --poses 4
node scripts/gen-y4m.mjs --src tests/fixtures/group_faces.png --out tests/fixtures/group.y4m
node scripts/gen-y4m.mjs --src tests/fixtures/group_faces.png --out tests/fixtures/group_noise.y4m --noise 7
node scripts/gen-y4m.mjs --src tests/fixtures/group_faces.png --out tests/fixtures/group_pan.y4m --pan 0.5
```
Expected: `wrote tests/fixtures/group_faces.png`, `… group6_faces.png`, `… group_people.jpg`, `wrote tests/fixtures/group_faces.landmarks.json (3 faces)` (or 4, if D is found), two `(… poses)` lines (`group_people` ≥ 2), three y4m lines.

**PD2 (S §6.3):** if the landmark JSON lacks the face at x ≈ 0.82 (C), set C's `scale` to `0.26` in `GROUP_FACES`, rerun the whole Step 7, and note it in the commit message. If A (0.22) or B (0.55) is missing, stop and report BLOCKED (the fixture cannot carry the e2e).

- [x] **Step 8: `.gitignore`, global setup and NOTICE**

`.gitignore:14`: replace `tests/fixtures/face.y4m` with `tests/fixtures/*.y4m`.

`tests/e2e/global-setup.ts`, inside `globalSetup()` after the `face.y4m` block:

```ts
  if (!existsSync(resolve(root, 'tests/fixtures/group.y4m'))) {
    const gen = resolve(root, 'scripts/gen-y4m.mjs');
    execFileSync(process.execPath, [gen, '--src', 'tests/fixtures/group_faces.png', '--out', 'tests/fixtures/group.y4m'], { cwd: root, stdio: 'inherit' });
  }
```

`LICENSES/NOTICE.txt`, after the `sample_face.png` lines (`:58-59`):

```
  - tests/fixtures/group_faces.png and tests/fixtures/group6_faces.png: modified derivatives of sample_face.png
    (Apache-2.0 §4(b) change notice): scaled, mirrored and cropped copies composed on a flat background by
    scripts/gen-group-fixture.mjs. group_faces.landmarks.json / group_faces.pose.json are this project's recorded
    Face / Pose Landmarker results on group_faces.png. The generated fake-camera clips group*.y4m derive from it.
  - tests/fixtures/group_people.jpg: modified derivative of fullbody.jpg and fullbody_yoga.jpg (Apache-2.0 §4(b)
    change notice): the two photos side by side at equal height (scripts/gen-group-fixture.mjs);
    group_people.pose.json is this project's recorded Pose Landmarker result on it.
```

- [x] **Step 9: Run the tests**

Run: `npx vitest run tests/harness/t5`
Expected: PASS (the new file and the existing `assets.test.mjs`, whose `face.y4m` checks prove the no-flag path is unchanged).

- [x] **Step 10: Commit**

```bash
git add scripts/gen-group-fixture.mjs scripts/gen-y4m.mjs scripts/record-landmarks.mjs scripts/record-pose.mjs tests/harness/t5/group-fixtures.test.mjs tests/e2e/global-setup.ts .gitignore LICENSES/NOTICE.txt tests/fixtures/group_faces.png tests/fixtures/group6_faces.png tests/fixtures/group_people.jpg tests/fixtures/group_faces.landmarks.json tests/fixtures/group_faces.pose.json tests/fixtures/group_people.pose.json
git commit -m "v0.4 step 1a: group fixtures (faces, six faces, two people), multi-face/pose recordings, y4m clips"
```

---

### Task 2: v0.3 parity goldens and `parity.spec.ts`

**Files:**
- Create: `tests/e2e/pages/parity.html`, `tests/e2e/pages/parity.ts`, `scripts/record-parity.mjs`, `tests/e2e/parity.spec.ts`
- Generated + committed: `tests/fixtures/parity-v03/natural.png`, `refined-shape-max.png`, `makeup-shades.png`, `fullbody-body.png`
- Modify: `LICENSES/NOTICE.txt` (one line)

**Interfaces:**
- Consumes (current API, `892ea61`): `createEngine` (`engine/index.ts:30`), `applyPreset`, `setParam`, `setShade`, `setHeightBand` (`params.ts`), `adapt` (`adapter111.ts:106`), `measureBody` (`measure.ts:193`), `buildBodyField` (`field.ts:99`), `RenderInput` (`types.ts:276-292`).
- Produces: `window.runParity(): Promise<{ renderer: string; png: Record<ParityCase, string> }>` with `ParityCase = 'natural' | 'refined-shape-max' | 'makeup-shades' | 'fullbody-body'`; `scripts/record-parity.mjs` writes the four PNGs. Later tasks port `parity.ts` to new APIs (Tasks 18 and 20 say exactly how); the goldens never change.

- [x] **Step 1: Confirm the source is v0.3**

Run: `git diff --stat 892ea61 -- src tests/e2e/pages`
Expected: no output (HEAD only added docs since `892ea61`). If anything is listed, check out `892ea61` into a worktree (`git worktree add ../meiyan-v03 892ea61`) and run Step 4 there instead.

- [x] **Step 2: Write the page**

`tests/e2e/pages/parity.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>v0.3 parity cases</title>
  </head>
  <body style="margin: 0; background: #000">
    <canvas id="gl"></canvas>
    <script type="module" src="./parity.ts"></script>
  </body>
</html>
```

`tests/e2e/pages/parity.ts`:

```ts
// v0.3 parity cases (RM §8.3, S §8.3): the same inputs through whatever the engine API is at the time. Recorded on
// 892ea61 by scripts/record-parity.mjs into tests/fixtures/parity-v03/, compared by tests/e2e/parity.spec.ts after
// every task. Only this file is ported when an API changes; the goldens never are.
import landmarks from '../../fixtures/landmarks_sample_face.json';
import pose from '../../fixtures/pose_fullbody.json';
import { measureBody } from '../../../src/body/measure';
import { buildBodyField } from '../../../src/body/field';
import { createEngine } from '../../../src/engine/index';
import { applyPreset, PARAM_DEFS, setHeightBand, setParam, setShade } from '../../../src/engine/params';
import { adapt } from '../../../src/tracking/adapter111';
import type { BeautyParams, BodyDetection, RenderInput } from '../../../src/types';

export type ParityCase = 'natural' | 'refined-shape-max' | 'makeup-shades' | 'fullbody-body';

declare global {
  interface Window {
    runParity?: () => Promise<{ renderer: string; png: Record<ParityCase, string> }>;
  }
}

function toPng(img: ImageData): string {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

async function bitmapOf(url: string, w?: number, h?: number): Promise<ImageBitmap> {
  const blob = await (await fetch(url)).blob();
  const opts: ImageBitmapOptions = { colorSpaceConversion: 'none', premultiplyAlpha: 'none' };
  return createImageBitmap(blob, w && h ? { ...opts, resizeWidth: w, resizeHeight: h, resizeQuality: 'high' } : opts);
}

window.runParity = async () => {
  // half size keeps the four committed goldens under 3 MB (landmarks are normalized: any size works)
  const face = await bitmapOf('/tests/fixtures/sample_face.png', 500, 750);
  const body = await bitmapOf('/tests/fixtures/fullbody.jpg');
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const engine = createEngine(canvas, { mirror: false });
  await engine.ready;
  await engine.loadFilter('soft');
  const gl = canvas.getContext('webgl2') as WebGL2RenderingContext;
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER));

  const f = adapt({ points: new Float32Array(landmarks.points) }, face.width, face.height);
  const onFace = (params: BeautyParams): RenderInput => ({ source: face, width: face.width, height: face.height, face: f, faceWeight: 1, params });

  const shapeMax = PARAM_DEFS.filter((d) => d.group === 'shape').reduce((p, d) => setParam(p, d.id, 1), applyPreset('refined', 1));
  const shades = setShade(setShade(applyPreset('natural', 1), 'lip', 'rose'), 'blush', 'peach');

  const det: BodyDetection = {
    pose: { points: new Float32Array(pose.points) },
    mask: pose.mask ? { width: pose.mask.width, height: pose.mask.height, data: Uint8Array.from(atob(pose.mask.data), (c) => c.charCodeAt(0)) } : null,
    people: pose.people,
    width: pose.width,
    height: pose.height,
  };
  const bodyParams = setHeightBand(setParam(setParam(applyPreset('natural', 1), 'body.waist', 1), 'body.legs', 1), { top: 0.55, bottom: 0.85, amount: 0.6 });
  const field = buildBodyField(measureBody(det, null), bodyParams, body.width / body.height);

  const png = {} as Record<ParityCase, string>;
  png.natural = toPng(engine.renderToImageData(onFace(applyPreset('natural', 1)), { mirror: false }));
  png['refined-shape-max'] = toPng(engine.renderToImageData(onFace(shapeMax), { mirror: false }));
  png['makeup-shades'] = toPng(engine.renderToImageData(onFace(shades), { mirror: false }));
  png['fullbody-body'] = toPng(
    engine.renderToImageData({ source: body, width: body.width, height: body.height, face: null, faceWeight: 0, params: bodyParams, body: field }, { mirror: false }),
  );
  engine.dispose();
  face.close();
  body.close();
  return { renderer, png };
};
```

- [x] **Step 3: Write `scripts/record-parity.mjs`**

```js
// Records the v0.3 parity goldens (RM §8.3): tests/e2e/pages/parity.html rendered by headless Chromium with the same
// SwiftShader flags as the e2e suite, served by a Vite dev server on a free port. Run on 892ea61 only.
//   node scripts/record-parity.mjs
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'tests', 'fixtures', 'parity-v03');
const ARGS = ['--enable-unsafe-swiftshader'];

async function launch() {
  try {
    return await chromium.launch({ args: ARGS });
  } catch (e) {
    const base = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
    const revs = existsSync(base) ? readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort() : [];
    for (const rev of revs.reverse()) {
      for (const exe of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome']) {
        const p = join(base, rev, exe);
        if (existsSync(p)) return chromium.launch({ executablePath: p, args: ARGS });
      }
    }
    throw e;
  }
}

const server = await createServer({ root, configFile: false, logLevel: 'error', server: { port: 0, host: '127.0.0.1' } });
await server.listen();
const port = server.httpServer.address().port;
const browser = await launch();
try {
  const page = await browser.newPage();
  page.on('console', (m) => m.type() === 'error' && console.error('[page]', m.text()));
  await page.goto(`http://127.0.0.1:${port}/tests/e2e/pages/parity.html`);
  await page.waitForFunction(() => typeof window.runParity === 'function', null, { timeout: 60_000 });
  const r = await page.evaluate(() => window.runParity());
  mkdirSync(out, { recursive: true });
  for (const [name, url] of Object.entries(r.png)) {
    writeFileSync(join(out, `${name}.png`), Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    console.log(`wrote tests/fixtures/parity-v03/${name}.png`);
  }
  console.log(`renderer: ${r.renderer}`);
} finally {
  await browser.close();
  await server.close();
}
```

- [x] **Step 4: Record the goldens**

Run: `node scripts/record-parity.mjs && du -ch tests/fixtures/parity-v03/*.png | tail -1`
Expected: four `wrote …` lines, a SwiftShader renderer line, total ≤ 3 MB.

- [x] **Step 5: Write `tests/e2e/parity.spec.ts`**

```ts
// Single-person parity (RM §1.1, S §1.3): the parity cases rendered by today's engine equal the v0.3 goldens within
// max 1/255 per channel and mean < 0.02/255. Runs after every task of step 1 (and every later step).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeDataUrl, decodePng, expect, test } from './fixtures';

const DEV_URL = 'http://127.0.0.1:5190';
const GOLDEN = resolve(import.meta.dirname, '../fixtures/parity-v03');

test('v0.3 parity: 自然, 精緻 + 美型 max, lip + blush shades, 細腰 + 長腿 + 增高', async ({ page }) => {
  await page.goto(`${DEV_URL}/tests/e2e/pages/parity.html`);
  await page.waitForFunction(() => typeof window.runParity === 'function');
  const r = await page.evaluate(() => window.runParity!());
  for (const [name, url] of Object.entries(r.png)) {
    const got = decodeDataUrl(url);
    const want = decodePng(readFileSync(resolve(GOLDEN, `${name}.png`)));
    expect([got.width, got.height], name).toEqual([want.width, want.height]);
    let max = 0;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < got.data.length; i += 4) {
      for (let k = 0; k < 3; k++) {
        const d = Math.abs(got.data[i + k] - want.data[i + k]);
        max = Math.max(max, d);
        sum += d;
        n++;
      }
    }
    console.log(`${name}: max ${max}/255, mean ${(sum / n).toFixed(4)}/255`);
    expect(max, name).toBeLessThanOrEqual(1);
    expect(sum / n, name).toBeLessThan(0.02);
  }
});
```

- [x] **Step 6: Run it**

Run: `npx playwright test tests/e2e/parity.spec.ts`
Expected: PASS, every case `max 0/255, mean 0.0000/255`.

- [x] **Step 7: NOTICE and commit**

`LICENSES/NOTICE.txt`, after the group lines added in Task 1:

```
  - tests/fixtures/parity-v03/*.png: this project's engine renders of sample_face.png and fullbody.jpg (modified
    derivatives, Apache-2.0 §4(b) change notice), made by scripts/record-parity.mjs as regression goldens.
```

```bash
git add tests/e2e/pages/parity.html tests/e2e/pages/parity.ts scripts/record-parity.mjs tests/e2e/parity.spec.ts tests/fixtures/parity-v03 LICENSES/NOTICE.txt
git commit -m "v0.4 step 1a: v0.3 parity goldens and parity.spec"
```

---

### Task 3: Limits, GL limits and probes, debug fields, bench 「多臉」 rows D / B / GL

**Files:**
- Create: `src/config/limits.ts`, `src/config/limits.test.ts`, `src/engine/glProbe.ts`, `src/bench/multiFace.ts`, `scripts/bench-multiface.mjs`
- Modify: `src/types.ts:409-421` (DebugState, CRLF), `src/app/debug.ts:7-18`, `src/ui/debug.ts:5-18`, `src/engine/index.ts:54-63` (CRLF), `src/bench/report.ts` (append), `src/bench/report.test.ts` (append), `src/bench/main.ts:154-216,684-702` (CRLF), `docs/superpowers/specs/2026-10-12-face-person-select-design.md` §6.4 (append results)

**Interfaces:**
- Consumes: `debugState()` (`app/debug.ts:5`), `FaceLandmarker`, `PoseLandmarker`, `FilesetResolver` (tasks-vision), `ENGINE_PATHS`, `loadPoseModel` (`engine/assets.ts`), `downscaleMask` (`bodyTracker.ts:204`).
- Produces:
  - `src/config/limits.ts` constants of the Global Constraints plus `export const FACE_TABLE_CARRIER: 'texture' | 'ubo' = 'texture'` and `export const LIVE_DETECT_FACES = 1` (the camera's `numFaces`; Task 25 sets it to `MAX_LIVE_FACES`).
  - `DebugState` gains `faces: number; persons: number; selected: string | null; detectCalls: number; boxes: { id: string; x: number; y: number; w: number; h: number }[]; gl?: Record<string, number | boolean>`.
  - `readGlLimits(gl: WebGL2RenderingContext): Record<string, number | boolean>`; `probeFaceTable(gl): { texture: boolean; ubo: boolean; float32: boolean | null }`; `probeR16FArray(gl): boolean`.
  - In `src/bench/report.ts` (pure, node-testable): `MultiRow = { row: string; config: string; values: Record<string, string | number> }` and `formatMultiRows(rows: readonly MultiRow[]): string` (its existing `median` is reused).
  - In `src/bench/multiFace.ts` (browser only, imports tasks-vision): `rowD(photo)`, `rowB(photo)`, `rowGL()`, `addRunner(id, run)`, `mountMultiFace(parent: HTMLElement): { rows(): readonly MultiRow[] }`; `window.__benchMulti = { run(ids: string[]): Promise<MultiRow[]> }` (only with `?fixtures=1`).

- [x] **Step 1: Write the failing tests**

```ts
// src/config/limits.test.ts
import { describe, expect, it } from 'vitest';
import * as L from './limits';

describe('limits (S §3.5)', () => {
  it('ships the Phase 0 defaults', () => {
    expect(L.MAX_EDIT_FACES).toBe(6);
    expect(L.EDIT_DETECT_FACES).toBe(L.MAX_EDIT_FACES + 2);
    expect(L.MAX_RENDER_FACES).toBe(6);
    expect(L.MAX_EDIT_BODIES).toBe(4);
    expect(L.MAX_LIVE_FACES).toBe(3);
    expect(L.MIN_FACE_FRAC).toBe(0.03);
    expect(L.LOST_HOLD_MS).toBe(1000);
    expect(L.ONE_EURO).toEqual({ minCutoff: 0.05, beta: 80, dCutoff: 1.0 });
    expect(L.SEED_BOX_PAD).toBe(0.25);
    expect(L.PROTECT_WINDOW).toBe(128);
    expect(L.MAX_OBSTACLES).toBe(8);
  });
  it('keeps the invariants the engine relies on', () => {
    expect(L.MAX_EDIT_FACES).toBeLessThanOrEqual(L.MAX_RENDER_FACES);
    expect(L.LIVE_DETECT_FACES).toBeLessThanOrEqual(L.MAX_LIVE_FACES);
    expect(['texture', 'ubo']).toContain(L.FACE_TABLE_CARRIER);
  });
});
```

Append to `src/bench/report.test.ts` (add `formatMultiRows` to its import from `./report`):

```ts
describe('bench 多臉 report', () => {
  it('formats rows as a tab-separated section with a header per row id', () => {
    const text = formatMultiRows([
      { row: 'D', config: 'GPU 2048 n8', values: { first_ms: 812.4, median_ms: 120, faces: 3 } },
      { row: 'D', config: 'CPU 1440 n1', values: { first_ms: 300, median_ms: 90, faces: 1 } },
      { row: 'GL', config: 'limits', values: { MAX_TEXTURE_SIZE: 16384 } },
    ]);
    expect(text).toContain('# 多臉 D');
    expect(text).toContain('config\tfirst_ms\tmedian_ms\tfaces');
    expect(text).toContain('GPU 2048 n8\t812.4\t120\t3');
    expect(text).toContain('# 多臉 GL');
  });
});
```

- [x] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/config/limits.test.ts src/bench/report.test.ts`
Expected: FAIL (cannot resolve `./limits`; `formatMultiRows` is not exported).

- [x] **Step 2b: Add the report formatter**

Append to `src/bench/report.ts`:

```ts
/** One measured row of the bench 「多臉」 section (S §6.2). */
export interface MultiRow {
  row: string;
  config: string;
  values: Record<string, string | number>;
}

/** One `# 多臉 <row>` block per row id: a header of the value keys, then one tab-separated line per config. */
export function formatMultiRows(rows: readonly MultiRow[]): string {
  const ids = [...new Set(rows.map((r) => r.row))];
  return ids
    .map((id) => {
      const rs = rows.filter((r) => r.row === id);
      const keys = [...new Set(rs.flatMap((r) => Object.keys(r.values)))];
      const line = (r: MultiRow) => [r.config, ...keys.map((k) => String(r.values[k] ?? ''))].join('\t');
      return [`# 多臉 ${id}`, ['config', ...keys].join('\t'), ...rs.map(line)].join('\n');
    })
    .join('\n\n');
}
```

- [x] **Step 3: Write `src/config/limits.ts`**

```ts
// Every number Phase 0 can change (step-1 spec §3.5, §6.3). A fallback is a one-line change here, committed together
// with the measurements (spec §6.4). iPhone numbers need a preview deploy, which only happens with the user's go-ahead:
// until then these defaults ship (RM §12 decision).

/** selectable faces per photo (§6.3 PD1, PR1, PE1, PM1) */
export const MAX_EDIT_FACES = 6;
/** numFaces of the editor's IMAGE detection: two spare so dropped.overCap is real and tiny faces take no slot (A1) */
export const EDIT_DETECT_FACES = MAX_EDIT_FACES + 2;
/** shader loop bound and face-table height (compile time) */
export const MAX_RENDER_FACES = 6;
/** numPoses of the 美體 detection (§6.3 PB1, PM1) */
export const MAX_EDIT_BODIES = 4;
/** faces the camera tracks; 1 hides the camera's 選臉 and bypasses the smoother (§6.3 PL1, PL2, PJ1) */
export const MAX_LIVE_FACES = 3;
/**
 * numFaces the camera requests (tracker.ts builds every instance with it). 1 = v0.3 (MediaPipe smooths at numFaces 1)
 * until sub-step 1e turns multi-face tracking on (Task 25 sets it to MAX_LIVE_FACES).
 */
export const LIVE_DETECT_FACES = 1;
/** a face box narrower than this fraction of the short edge is not selectable and gets no face effects */
export const MIN_FACE_FRAC = 0.03;
/** camera: a missing track is held this long, then dropped */
export const LOST_HOLD_MS = 1000;
/** camera smoothing: MediaPipe's own LandmarksSmoothingCalculator values (Hz; values scaled by 1 / face size) */
export const ONE_EURO = { minCutoff: 0.05, beta: 80, dCutoff: 1.0 } as const;
/** seed → face match: the face box padded by this fraction must contain the seed */
export const SEED_BOX_PAD = 0.25;
/** 瘦臉 limit layer edge with ≥ 2 selectable faces (§4.7) */
export const PROTECT_WINDOW = 128;
/** obstacles kept in a detection cache (validation bound) */
export const MAX_OBSTACLES = 8;
/** the face table's carrier (§4.4): the faster of the two on the test iPhone; a PG1 failure forces 'ubo' */
export const FACE_TABLE_CARRIER: 'texture' | 'ubo' = 'texture';
```

- [x] **Step 4: Debug state fields**

`src/types.ts` (CRLF), `DebugState` (`:409-421`), after `face: boolean;` add:

```ts
  /** selectable faces (editor) / shown tracks (camera) */
  faces: number;
  persons: number;
  /** selected person id, 'all', or null (no persons / camera) */
  selected: string | null;
  /** face detectImage calls in this page session */
  detectCalls: number;
  /** face boxes, normalized and unmirrored (editor: cache faces; camera: shown tracks) */
  boxes: { id: string; x: number; y: number; w: number; h: number }[];
  /** Phase 0: GL limits (always) and probes (bench and dev builds only) */
  gl?: Record<string, number | boolean>;
```

In both `src/app/debug.ts:7-17` and `src/ui/debug.ts:7-16` add to the initial object, after `face: false,`: `faces: 0, persons: 0, selected: null, detectCalls: 0, boxes: [],`.

- [x] **Step 5: Write `src/engine/glProbe.ts`**

```ts
// Phase 0 GL limits and probes (S §6.2). Limits are plain getParameter reads (free) and are logged once per engine
// build. The probes compile tiny programs and read pixels back, so they run only in /bench.html and dev builds: in
// production they would stall every engine build, and the face-table carrier is a build-time choice anyway.

export function readGlLimits(gl: WebGL2RenderingContext): Record<string, number | boolean> {
  return {
    MAX_FRAGMENT_UNIFORM_VECTORS: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) as number,
    MAX_UNIFORM_BLOCK_SIZE: gl.getParameter(gl.MAX_UNIFORM_BLOCK_SIZE) as number,
    MAX_TEXTURE_SIZE: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    MAX_TEXTURE_IMAGE_UNITS: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) as number,
    MAX_ARRAY_TEXTURE_LAYERS: gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number,
    EXT_color_buffer_float: !!gl.getExtension('EXT_color_buffer_float'),
    OES_texture_float_linear: !!gl.getExtension('OES_texture_float_linear'),
  };
}

const VS = `#version 300 es
void main() { vec2 p = vec2(float(gl_VertexID % 2), float(gl_VertexID / 2)) * 4.0 - 1.0; gl_Position = vec4(p, 0.0, 1.0); }`;

/** the four PG1 values: float32 literals, an fp16 or mediump path fails them, ±1e9 overflows fp16 (EMPTY_BOX) */
export const PROBE_VALUES = [0.123456789, 0.999999, 1e9, -1e9] as const;
const LIT = 'vec4(0.123456789, 0.999999, 1e9, -1e9)';

function program(gl: WebGL2RenderingContext, fs: string): WebGLProgram | null {
  const mk = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  };
  const v = mk(gl.VERTEX_SHADER, VS);
  const f = mk(gl.FRAGMENT_SHADER, fs);
  if (!v || !f) return null;
  const p = gl.createProgram()!;
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  gl.deleteShader(v);
  gl.deleteShader(f);
  return gl.getProgramParameter(p, gl.LINK_STATUS) ? p : null;
}

/** Draw one pixel with `prog` into a fresh RGBA8 (or RGBA32F) target and read it back. */
function drawPixel(gl: WebGL2RenderingContext, prog: WebGLProgram, float: boolean): Uint8Array | Float32Array {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, float ? gl.RGBA32F : gl.RGBA8, 1, 1, 0, gl.RGBA, float ? gl.FLOAT : gl.UNSIGNED_BYTE, null);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.viewport(0, 0, 1, 1);
  gl.useProgram(prog);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const out = float ? new Float32Array(4) : new Uint8Array(4);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, float ? gl.FLOAT : gl.UNSIGNED_BYTE, out);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fbo);
  gl.deleteTexture(tex);
  return out;
}

const near128 = (px: Uint8Array | Float32Array) => Array.from(px).every((v) => Math.abs(v - 128) <= 1);

/**
 * PG1: a 96×2 RGBA32F NEAREST texture and a std140 UBO of 192 vec4 each hold the probe values at their last texel;
 * each is fetched and written as 0.5 + (fetched − expected)·2^16 into RGBA8, passing only at 128 ± 1. With
 * EXT_color_buffer_float the texture path is also rendered into RGBA32F and compared within 2^-20 relative.
 */
export function probeFaceTable(gl: WebGL2RenderingContext): { texture: boolean; ubo: boolean; float32: boolean | null } {
  const data = new Float32Array(96 * 2 * 4);
  data.set(PROBE_VALUES, (96 * 2 - 1) * 4);
  const tex = gl.createTexture()!;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 96, 2, 0, gl.RGBA, gl.FLOAT, data);
  const texFs = (out: string) => `#version 300 es
precision highp float;
uniform highp sampler2D uT;
out vec4 o;
void main() { vec4 v = texelFetch(uT, ivec2(95, 1), 0); ${out} }`;
  let texture = false;
  let float32: boolean | null = null;
  const p1 = program(gl, texFs(`o = vec4(0.5) + (v - ${LIT}) * 65536.0 / 255.0;`));
  if (p1) {
    gl.useProgram(p1);
    gl.uniform1i(gl.getUniformLocation(p1, 'uT'), 0);
    texture = near128(drawPixel(gl, p1, false));
    gl.deleteProgram(p1);
  }
  if (gl.getExtension('EXT_color_buffer_float')) {
    const p2 = program(gl, texFs('o = v;'));
    if (p2) {
      gl.useProgram(p2);
      gl.uniform1i(gl.getUniformLocation(p2, 'uT'), 0);
      const got = drawPixel(gl, p2, true);
      float32 = PROBE_VALUES.every((v, i) => Math.abs(got[i] - Math.fround(v)) <= Math.abs(Math.fround(v)) * 2 ** -20);
      gl.deleteProgram(p2);
    }
  }
  gl.deleteTexture(tex);

  let ubo = false;
  const p3 = program(
    gl,
    `#version 300 es
precision highp float;
layout(std140) uniform T { vec4 uT[192]; };
out vec4 o;
void main() { o = vec4(0.5) + (uT[191] - ${LIT}) * 65536.0 / 255.0; }`,
  );
  if (p3) {
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.UNIFORM_BUFFER, buf);
    gl.bufferData(gl.UNIFORM_BUFFER, data, gl.STATIC_DRAW);
    gl.uniformBlockBinding(p3, gl.getUniformBlockIndex(p3, 'T'), 0);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, buf);
    ubo = near128(drawPixel(gl, p3, false));
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, null);
    gl.deleteBuffer(buf);
    gl.deleteProgram(p3);
  }
  return { texture, ubo, float32 };
}

/** PG2: a 2-layer R16F TEXTURE_2D_ARRAY, LINEAR, sampled with textureLod between the two texels of layer 1 → 0.5. */
export function probeR16FArray(gl: WebGL2RenderingContext): boolean {
  const tex = gl.createTexture()!;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D_ARRAY, p, gl.LINEAR);
  for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D_ARRAY, p, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.R16F, 2, 1, 2, 0, gl.RED, gl.FLOAT, new Float32Array([0, 0, 0.25, 0.75]));
  const p = program(
    gl,
    `#version 300 es
precision highp float;
uniform mediump sampler2DArray uA;
out vec4 o;
void main() { o = vec4(textureLod(uA, vec3(0.5, 0.5, 1.0), 0.0).r, 0.5, 0.5, 0.5); }`,
  );
  let ok = false;
  if (p) {
    gl.useProgram(p);
    gl.uniform1i(gl.getUniformLocation(p, 'uA'), 0);
    ok = near128(drawPixel(gl, p, false));
    gl.deleteProgram(p);
  }
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
  gl.deleteTexture(tex);
  return ok;
}
```

- [x] **Step 6: Log GL limits in `build()` and probe in dev**

`src/engine/index.ts` (CRLF): add imports `import { debugState } from '../app/debug';` and `import { probeFaceTable, probeR16FArray, readGlLimits } from './glProbe';`. At the end of `build()` (after `maxSize = …;`, `:62`) add:

```ts
    // Phase 0 (S §6.2): GL limits once per page, probes only in dev builds; never fatal (a fake or odd context in
    // tests, a driver that refuses a probe shader)
    const dbg = debugState();
    if (dbg && !dbg.gl) {
      try {
        const limits = readGlLimits(gl);
        console.info('[engine] GL limits', limits);
        const probes = import.meta.env.DEV ? probeFaceTable(gl) : null;
        dbg.gl = {
          ...limits,
          ...(probes ? { PG1_texture: probes.texture, PG1_ubo: probes.ubo, ...(probes.float32 === null ? {} : { PG1_float32: probes.float32 }) } : {}),
          ...(import.meta.env.DEV ? { PG2: probeR16FArray(gl) } : {}),
        };
      } catch (e) {
        console.warn('[engine] GL limits / probes unavailable', e);
      }
    }
```

(The probes leave no GL state behind except bindings `pipeline.ts` resets per frame; `createPipeline` already ran. In the node unit tests `window` is undefined, so `debugState()` is null and nothing runs; `src/engine/index.test.ts`'s fake context has no `getExtension`.)

- [x] **Step 7: Write `src/bench/multiFace.ts`**

```ts
// Bench 「多臉」 section (S §6.2 rows). Rows D (multi-face detectImage), B (multi-pose body detection) and GL (limits +
// probes) land in Phase 0; later tasks add R, RC, RP (Task 17), F (Task 19), BF (Task 20), PE, M (Task 23) and L, J,
// J2 (Task 25). Results join 複製結果 through formatMultiRows. /bench.html?fixtures=1 (dev server) loads the group
// fixtures by URL so scripts/bench-multiface.mjs can drive it; on a phone the rows take a picked photo.
import { FaceLandmarker, FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { ENGINE_PATHS, loadEngineAssets, loadPoseModel } from '../engine/assets';
import { probeFaceTable, probeR16FArray, readGlLimits } from '../engine/glProbe';
import { downscaleMask } from '../tracking/bodyTracker';
import { formatMultiRows, median, type MultiRow } from './report';

const rows: MultiRow[] = [];
const now = () => performance.now();
const round = (v: number) => Math.round(v * 10) / 10;

async function decode(blob: Blob, longEdge: number): Promise<ImageBitmap> {
  const probe = await createImageBitmap(blob);
  const s = Math.min(1, longEdge / Math.max(probe.width, probe.height));
  const w = Math.round(probe.width * s);
  const h = Math.round(probe.height * s);
  probe.close();
  return createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
}

/** D: detectImage at numFaces 1/4/6/8 on GPU and CPU, decodes 2048 and 1440: first call, median of 5, faces, order */
export async function rowD(photo: Blob): Promise<MultiRow[]> {
  const out: MultiRow[] = [];
  const { modelBuffer } = await loadEngineAssets();
  const fileset = await FilesetResolver.forVisionTasks(ENGINE_PATHS.wasmBase);
  for (const delegate of ['GPU', 'CPU'] as const) {
    const canvas = new OffscreenCanvas(1, 1);
    const lm = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: modelBuffer, delegate },
      runningMode: 'IMAGE',
      numFaces: 1,
      canvas: delegate === 'GPU' ? canvas : undefined,
    });
    const orders: Record<number, string[]> = {};
    for (const edge of [2048, 1440]) {
      const bmp = await decode(photo, edge);
      for (const n of [1, 4, 6, 8]) {
        await lm.setOptions({ numFaces: n });
        const t0 = now();
        const first = lm.detect(bmp).faceLandmarks;
        const firstMs = now() - t0;
        const times: number[] = [];
        for (let i = 0; i < 5; i++) {
          const t = now();
          lm.detect(bmp);
          times.push(now() - t);
        }
        const centres = first.map((f) => {
          let lo = 1;
          let hi = 0;
          for (const p of f) {
            lo = Math.min(lo, p.x);
            hi = Math.max(hi, p.x);
          }
          return ((lo + hi) / 2).toFixed(2);
        });
        if (n === 8) orders[edge] = centres;
        out.push({ row: 'D', config: `${delegate} ${edge} n${n}`, values: { first_ms: round(firstMs), median_ms: round(median(times)), faces: first.length, centres: centres.join(' ') } });
      }
      bmp.close();
    }
    out.push({ row: 'D', config: `${delegate} order 2048 vs 1440 (n8)`, values: { same: String(orders[2048]?.join() === orders[1440]?.join()) } });
    lm.close();
  }
  return out;
}

/** B: body detection with numPoses 2 and 4 (GPU + masks): time, readback + downscale per person, persons, peak heap */
export async function rowB(photo: Blob): Promise<MultiRow[]> {
  const out: MultiRow[] = [];
  const buf = await loadPoseModel('full', () => undefined);
  const fileset = await FilesetResolver.forVisionTasks(ENGINE_PATHS.wasmBase);
  const bmp = await decode(photo, 1280);
  const heap = () => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;
  for (const numPoses of [2, 4]) {
    const lm = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: buf, delegate: 'GPU' },
      runningMode: 'IMAGE',
      numPoses,
      outputSegmentationMasks: true,
      canvas: new OffscreenCanvas(1, 1),
    });
    let peak = heap();
    const t0 = now();
    const r = lm.detect(bmp);
    const detectMs = now() - t0;
    const masks = r.segmentationMasks ?? [];
    // (readonly in the typings) so r.close() cannot reach the masks: one readback alive at a time (P2)
    (r as unknown as { segmentationMasks: unknown[] }).segmentationMasks = [];
    const per: number[] = [];
    for (const m of masks) {
      const t = now();
      downscaleMask(m.getAsFloat32Array(), m.width, m.height);
      peak = Math.max(peak, heap());
      m.close();
      per.push(now() - t);
    }
    r.close();
    lm.close();
    out.push({
      row: 'B',
      config: `numPoses ${numPoses}`,
      values: { detect_ms: round(detectMs), readback_ms_per_person: round(median(per)), persons: r.landmarks.length, peak_heap_mb: round(peak / 2 ** 20) },
    });
  }
  bmp.close();
  return out;
}

/** GL: limits and both probes on a fresh WebGL2 context */
export function rowGL(): MultiRow[] {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return [{ row: 'GL', config: 'webgl2', values: { available: 'no' } }];
  const pg1 = probeFaceTable(gl);
  const out: MultiRow[] = [
    { row: 'GL', config: 'limits', values: Object.fromEntries(Object.entries(readGlLimits(gl)).map(([k, v]) => [k, typeof v === 'boolean' ? String(v) : v])) },
    { row: 'GL', config: 'probes', values: { PG1_texture: String(pg1.texture), PG1_ubo: String(pg1.ubo), PG1_float32: String(pg1.float32), PG2: String(probeR16FArray(gl)) } },
  ];
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return out;
}

const RUNNERS: Record<string, (photos: { faces: Blob; people: Blob }) => Promise<MultiRow[]> | MultiRow[]> = {
  D: (p) => rowD(p.faces),
  B: (p) => rowB(p.people),
  GL: () => rowGL(),
};

/** Register a row runner (later tasks: R, F, BF, PE, L, J, J2). */
export function addRunner(id: string, run: (photos: { faces: Blob; people: Blob }) => Promise<MultiRow[]> | MultiRow[]): void {
  RUNNERS[id] = run;
}

async function fixtures(): Promise<{ faces: Blob; people: Blob }> {
  const get = async (u: string) => (await fetch(u)).blob();
  return { faces: await get('/tests/fixtures/group_faces.png'), people: await get('/tests/fixtures/group_people.jpg') };
}

export function mountMultiFace(parent: HTMLElement): { rows(): readonly MultiRow[] } {
  const section = document.createElement('section');
  section.innerHTML = '<h3>多臉</h3><p class="note">D：多臉偵測（選 group_faces.png）　B：多人美體（選 group_people.jpg）　GL：GPU 上限</p>';
  const note = document.createElement('pre');
  const pick = (accept: string) =>
    new Promise<Blob | null>((resolve) => {
      const i = document.createElement('input');
      i.type = 'file';
      i.accept = accept;
      i.addEventListener('change', () => resolve(i.files?.[0] ?? null));
      i.click();
    });
  const run = async (id: string) => {
    note.textContent = `${id}…`;
    try {
      const photo = id === 'GL' ? null : await pick('image/*');
      const blob = photo ?? new Blob();
      const got = await RUNNERS[id]({ faces: blob, people: blob });
      rows.push(...got);
      note.textContent = formatMultiRows(rows);
    } catch (e) {
      note.textContent = `${id}: ${e instanceof Error ? e.message : String(e)}`;
    }
  };
  for (const id of ['D', 'B', 'GL']) {
    const b = document.createElement('button');
    b.textContent = id;
    b.addEventListener('click', () => void run(id));
    section.append(b);
  }
  section.append(note);
  parent.append(section);
  if (new URLSearchParams(location.search).has('fixtures')) {
    (window as Window & { __benchMulti?: unknown }).__benchMulti = {
      run: async (ids: string[]) => {
        const photos = await fixtures();
        const out: MultiRow[] = [];
        for (const id of ids) out.push(...(await RUNNERS[id](photos)));
        rows.push(...out);
        return out;
      },
    };
  }
  return { rows: () => rows };
}
```

- [x] **Step 8: Mount it in the bench page**

`src/bench/main.ts` (CRLF): add `import { mountMultiFace } from './multiFace';` and `formatMultiRows` to its existing `./report` import. After the `bodySection` definition (`:207-217`) add `const multi = mountMultiFace(root);`. In `copyResults()` (`:684`) change the first line to:

```ts
  const multiText = multi.rows().length ? `\n\n${formatMultiRows(multi.rows())}` : '';
  const text = formatReport(reportMeta(), samples, bodyRows) + multiText;
```

- [x] **Step 9: Write the desktop driver `scripts/bench-multiface.mjs`**

```js
// Runs the bench 「多臉」 rows on this desktop and prints them as Markdown for spec §6.4. Tries a headed Chrome with
// the GPU first (timings), falls back to headless SwiftShader (marked "not representative").
//   node scripts/bench-multiface.mjs D B GL
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['D', 'B', 'GL'];
const server = await createServer({ root, configFile: resolve(root, 'vite.config.ts'), logLevel: 'error', server: { port: 0, host: '127.0.0.1' } });
await server.listen();
const port = server.httpServer.address().port;
let browser;
let gpu = true;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--ignore-gpu-blocklist'] });
} catch {
  gpu = false;
  browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
}
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/bench.html?fixtures=1`);
  await page.waitForFunction(() => !!window.__benchMulti, null, { timeout: 120_000 });
  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const d = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl ? String(gl.getParameter(d ? d.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : 'none';
  });
  const rows = await page.evaluate((list) => window.__benchMulti.run(list), ids);
  const date = new Date().toISOString().slice(0, 10);
  console.log(`\n#### ${date} desktop ${gpu ? 'Chrome (GPU)' : 'Chromium SwiftShader (not representative)'} — ${renderer}\n`);
  console.log('| Row | Config | Values |\n|---|---|---|');
  for (const r of rows) console.log(`| ${r.row} | ${r.config} | ${Object.entries(r.values).map(([k, v]) => `${k} ${v}`).join(', ')} |`);
} finally {
  await browser.close();
  await server.close();
}
```

- [x] **Step 10: Run the unit tests and the typecheck**

Run: `npx vitest run src/config/limits.test.ts src/bench/report.test.ts && npm run typecheck`
Expected: PASS, then `tsc` exits 0.

- [x] **Step 11: Measure on this desktop and record**

Run: `node scripts/bench-multiface.mjs D B GL`
Expected: a Markdown block with D rows for GPU/CPU × 2048/1440 × n 1/4/6/8 (faces ≥ 3 at n ≥ 4 on 2048), two B rows (`persons` 2 for `numPoses 4` on group_people), GL `limits` and `probes` rows.

Append to S §6.4 a subsection `#### Results` (first run) with the printed block and one line: `Decisions: none taken (desktop only; the §3.5 defaults ship until iPhone rows exist, RM §12). PG1/PG2 on desktop: <copy the probes row>.` If `PG1_texture` is `false` on desktop, also set `FACE_TABLE_CARRIER = 'ubo'` in `limits.ts` (S §6.3 PG1) and say so in that line. Add one more line for the S §3.4 T4 smoother check: `ONE_EURO: LandmarksSmoothingCalculator is compiled into node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm (0.10.35); its face-graph options are not readable from the binary offline, so the §3.5 values {minCutoff 0.05, beta 80, dCutoff 1.0} ship unverified until checked against the 0.10.35 source.` (replace the clause after the semicolon with the outcome if you can check them).

- [x] **Step 12: Run the bench e2e and commit**

Run: `npm run build && npx playwright test tests/e2e/bench.spec.ts tests/e2e/parity.spec.ts`
Expected: PASS.

```bash
git add src/config src/engine/glProbe.ts src/engine/index.ts src/types.ts src/app/debug.ts src/ui/debug.ts src/bench/multiFace.ts src/bench/report.ts src/bench/report.test.ts src/bench/main.ts scripts/bench-multiface.mjs docs/superpowers/specs/2026-10-12-face-person-select-design.md
git commit -m "v0.4 step 1a: limits.ts, GL limits and probes, bench 多臉 rows D/B/GL with desktop results"
```

---

## Sub-step 1b — Param model and HistoryEntry v2 (behaviour unchanged)

### Task 4: Edit types, the scope table, `EditState` constructors and the v1 ↔ v2 split

**Files:**
- Modify: `src/types.ts:36-47` (ParamDef) and append the RM §3.2 / §3.6 shapes after `HeightBand` (`:107`) (CRLF); `src/engine/params.ts:4-37` (`scope`, `live` on every def), `:211, :313` (export `cleanBand`, `sanitizeBand`)
- Create: `src/edit/state.ts`, `src/edit/legacy.ts`, `src/edit/state.test.ts`, `src/edit/legacy.test.ts`

**Interfaces:**
- Consumes: `applyPreset`, `PARAM_DEFS`, `sanitizeParams` (`params.ts`), `stableKey` (`undo.ts:65`).
- Produces (types, `src/types.ts`): `ParamScope = 'photo' | 'person'`; `ParamDef.scope: ParamScope`, `ParamDef.live: boolean`; `PhotoParamId = Extract<ParamId, 'skin.whiten' | 'skin.sharpen' | 'filter.amount' | 'body.legs'>`; `PersonParamId = Exclude<ParamId, PhotoParamId>`; `ShadePart = 'lip' | 'blush'`; `PersonId = string`; `PresetRef {id: PresetId; amount: number}`; `Rect {x; y; w; h}`; `PhotoParams {values: Record<PhotoParamId, number>; filterId: string; presetLink: PresetRef | null; bodyProtect: boolean; heightBand: HeightBand | null; legsAnchor: PersonId | null}`; `PersonParams {values: Record<PersonParamId, number>; shades: Record<ShadePart, string | null>; preset: PresetRef | 'custom'}`; `EditState {v: 2; photo; persons: Readonly<Record<PersonId, PersonParams>>; template; primaryInit: PersonParams | null}`; `Selection = {kind: 'all'} | {kind: 'person'; id: PersonId}`; `CameraLook {photo; person}`; `FaceSeed = {x; y} | 'all' | null`; `CachedFace {id; lm: Float32Array; box: Rect}`; `CachedObstacle {box: Rect; oval: Float32Array}`; `CachedBody {id; pose: Pose33; mask: PersonMask | null; score: number}`; `PersonInfoCached {id; face: string | null; body: string | null}`; `DetectionCache` (S §3.2); `BodyDetections {bodies: {pose; mask; score}[]; width; height}`.
- Produces (`src/edit/state.ts`): `P0 = 'p0'`, `LIVE = 'live'`, `PERSON_ID: RegExp`, `PHOTO_IDS`, `PERSON_IDS`, `PRESET_PERSON_IDS`, `PRESET_PHOTO_IDS`; `personFromPreset(id: PresetId, amount: number): PersonParams`, `neutralPerson(): PersonParams`, `naturalPerson(): PersonParams`, `defaultPhoto(): PhotoParams`, `editKey(edit: EditState): string`, `personOf(edit: EditState, id: PersonId): PersonParams`, `withPhoto(edit, f: (p: PhotoParams) => PhotoParams): EditState`, `withPersons(edit, ids: readonly PersonId[], f: (p: PersonParams, id: PersonId) => PersonParams): EditState`, `cameraEdit(look: CameraLook): EditState`, `lookOf(edit: EditState): CameraLook`.
- Produces (`src/edit/legacy.ts`): `splitLegacy(p: BeautyParams): { photo: PhotoParams; person: PersonParams }`, `legacyProjection(edit: EditState, primary: PersonId): BeautyParams`, `editFromLegacy(p: BeautyParams, opts?: { primaryInit?: boolean }): EditState`.

- [x] **Step 1: Write the failing tests**

```ts
// src/edit/state.test.ts
import { describe, expect, it } from 'vitest';
import { applyPreset, PARAM_DEFS } from '../engine/params';
import { cameraEdit, defaultPhoto, editKey, lookOf, naturalPerson, neutralPerson, PERSON_IDS, PHOTO_IDS, withPersons } from './state';

describe('scope table (RM §3.1, step-1 subset)', () => {
  it('every ParamId has exactly one scope and the layers do not overlap', () => {
    for (const d of PARAM_DEFS) expect(['photo', 'person']).toContain(d.scope);
    expect([...PHOTO_IDS].sort()).toEqual(['body.legs', 'filter.amount', 'skin.sharpen', 'skin.whiten']);
    expect(PHOTO_IDS.length + PERSON_IDS.length).toBe(PARAM_DEFS.length);
    expect(PHOTO_IDS.filter((id) => (PERSON_IDS as readonly string[]).includes(id))).toEqual([]);
    const person = PARAM_DEFS.filter((d) => d.scope === 'person').map((d) => d.id);
    expect(person).toEqual(expect.arrayContaining(['skin.smooth', 'skin.rosy', 'makeup.lip', 'makeup.blush']));
    expect(person.filter((id) => id.startsWith('shape.'))).toHaveLength(9);
    expect(person.filter((id) => id.startsWith('body.'))).toHaveLength(9);
  });
  it('live: everything but 美體 is offered in the camera', () => {
    for (const d of PARAM_DEFS) expect(d.live, d.id).toBe(d.group !== 'body');
  });
});

describe('constructors', () => {
  it('defaultPhoto is the 自然 photo part, linked to 自然 100', () => {
    const n = applyPreset('natural', 1);
    const p = defaultPhoto();
    for (const id of PHOTO_IDS) expect(p.values[id]).toBe(n.values[id]);
    expect(p).toMatchObject({ filterId: 'none', presetLink: { id: 'natural', amount: 1 }, bodyProtect: true, heightBand: null, legsAnchor: null });
  });
  it('naturalPerson is the 自然 person part; neutralPerson is 原圖', () => {
    const n = applyPreset('natural', 1);
    const np = naturalPerson();
    for (const id of PERSON_IDS) expect(np.values[id]).toBe(n.values[id]);
    expect(np.preset).toEqual({ id: 'natural', amount: 1 });
    expect(neutralPerson().preset).toEqual({ id: 'original', amount: 1 });
    expect(neutralPerson().values['shape.chin']).toBe(0.5);
    expect(neutralPerson().values['skin.smooth']).toBe(0);
    expect(neutralPerson().shades).toEqual({ lip: null, blush: null });
  });
  it('cameraEdit / lookOf round-trip the camera look through the one person "live"', () => {
    const look = { photo: defaultPhoto(), person: naturalPerson() };
    const e = cameraEdit(look);
    expect(Object.keys(e.persons)).toEqual(['live']);
    expect(lookOf(e)).toEqual(look);
  });
  it('editKey does not depend on key order; withPersons shares untouched persons', () => {
    const a = { v: 2 as const, photo: defaultPhoto(), persons: { f0: naturalPerson(), f1: neutralPerson() }, template: neutralPerson(), primaryInit: null };
    const b = { ...a, persons: { f1: a.persons.f1, f0: a.persons.f0 } };
    expect(editKey(a)).toBe(editKey(b));
    const c = withPersons(a, ['f0'], (p) => ({ ...p, preset: 'custom' }));
    expect(c.persons.f1).toBe(a.persons.f1);
    expect(c.persons.f0).not.toBe(a.persons.f0);
    expect(c.photo).toBe(a.photo);
  });
});
```

```ts
// src/edit/legacy.test.ts
import { describe, expect, it } from 'vitest';
import { applyPreset, BLUSH_SHADES, defaultParams, FILTERS, LIP_SHADES, PARAM_DEFS, PRESETS, sanitizeParams } from '../engine/params';
import type { BeautyParams } from '../types';
import { editFromLegacy, legacyProjection, splitLegacy } from './legacy';

/** presetAmount is dead data while custom (setPresetAmount ignores it, a preset tap overwrites it) */
const canon = (p: BeautyParams): BeautyParams => (p.presetId === 'custom' ? { ...p, presetAmount: 1 } : p);

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('splitLegacy / legacyProjection (RM §3.2)', () => {
  it('round-trips every preset at several 程度', () => {
    for (const p of PRESETS) {
      for (const a of [0, 0.35, 1]) {
        const v1 = applyPreset(p.id, a);
        expect(legacyProjection(editFromLegacy(v1), 'p0')).toEqual(canon(v1));
      }
    }
    expect(legacyProjection(editFromLegacy(defaultParams()), 'p0')).toEqual(defaultParams());
  });
  it('round-trips 500 random sanitized v1 params', () => {
    const r = rng(42);
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
    for (let i = 0; i < 500; i++) {
      const raw = {
        values: Object.fromEntries(PARAM_DEFS.map((d) => [d.id, r()])),
        filterId: pick(FILTERS).id,
        lipShade: pick([null, ...LIP_SHADES.map((s) => s.id)]),
        blushShade: pick([null, ...BLUSH_SHADES.map((s) => s.id)]),
        presetId: pick([...PRESETS.map((p) => p.id), 'custom']),
        presetAmount: r(),
        bodyProtect: r() < 0.5,
        heightBand: r() < 0.5 ? null : { top: 0.2, bottom: 0.6, amount: r() },
      };
      const p = sanitizeParams(raw);
      expect(legacyProjection(editFromLegacy(p), 'p0')).toEqual(canon(p));
    }
  });
  it('splits photo items to the photo and the rest to the person', () => {
    const { photo, person } = splitLegacy(applyPreset('glow', 1));
    expect(Object.keys(photo.values).sort()).toEqual(['body.legs', 'filter.amount', 'skin.sharpen', 'skin.whiten']);
    expect('skin.whiten' in person.values).toBe(false);
    expect(person.shades).toEqual({ lip: 'bean', blush: 'peach' });
    expect(person.preset).toEqual({ id: 'glow', amount: 1 });
    expect(photo.presetLink).toEqual({ id: 'glow', amount: 1 });
  });
  it('the projection is custom when the photo link and the person preset disagree', () => {
    const e = editFromLegacy(defaultParams());
    expect(legacyProjection({ ...e, photo: { ...e.photo, presetLink: null } }, 'p0').presetId).toBe('custom');
  });
  it('editFromLegacy keeps the look as primaryInit for v1 entries', () => {
    const e = editFromLegacy(applyPreset('refined', 1), { primaryInit: true });
    expect(e.primaryInit).toBe(e.persons.p0);
    expect(e.template.preset).toEqual({ id: 'original', amount: 1 });
  });
});
```

- [x] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/edit`
Expected: FAIL (cannot resolve `./state`, `./legacy`).

- [x] **Step 3: Types**

`src/types.ts` (CRLF). Above `export interface ParamDef` add `export type ParamScope = 'photo' | 'person';`. In `ParamDef` (`:36-47`), after `icon: string;`, add:

```ts
  /** which layer the value lives in (RM §3.1): the whole photo, or each person */
  scope: ParamScope;
  /** offered in the live camera */
  live: boolean;
```

After the `HeightBand` interface (`:107`) add:

```ts
// ───────────────────────── v0.4 edit model (RM §3.2, step-1 subset) ─────────────────────────

export type PhotoParamId = Extract<ParamId, 'skin.whiten' | 'skin.sharpen' | 'filter.amount' | 'body.legs'>;
export type PersonParamId = Exclude<ParamId, PhotoParamId>;
export type ShadePart = 'lip' | 'blush';
/**
 * 'f0'…'f5' a person first built from a face, 'b0'…'b3' from a body, 'p0' the implicit person while nobody is known,
 * 'live' the camera. Immutable once persisted (a person keeps its id when it gains a face or a body).
 */
export type PersonId = string;
export interface PresetRef {
  id: PresetId;
  amount: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface PhotoParams {
  values: Record<PhotoParamId, number>;
  filterId: string;
  /** the photo part of the last beauty preset, while 美白 / 銳化 / 濾鏡 are untouched since (RM §3.4) */
  presetLink: PresetRef | null;
  bodyProtect: boolean;
  heightBand: HeightBand | null;
  /** the person 長腿 is measured on; null = the primary person */
  legsAnchor: PersonId | null;
}
export interface PersonParams {
  values: Record<PersonParamId, number>;
  shades: Record<ShadePart, string | null>;
  preset: PresetRef | 'custom';
}
/** The undoable, persisted edit of one photo. Immutable: every change returns a new object sharing unchanged parts. */
export interface EditState {
  v: 2;
  photo: PhotoParams;
  persons: Readonly<Record<PersonId, PersonParams>>;
  /** params for persons who first appear later */
  template: PersonParams;
  /** the look meant for the primary person; seeds `p0`, consumed by the first assignPersons, then null */
  primaryInit: PersonParams | null;
}
export type Selection = { kind: 'all' } | { kind: 'person'; id: PersonId };
/** what the camera keeps (persisted as meiyan.look.v1): only `live` items are meaningful */
export interface CameraLook {
  photo: PhotoParams;
  person: PersonParams;
}
/** camera → editor: the beautified face's centre in the saved image, 'all' under 全部套用, null = no face seen */
export type FaceSeed = { x: number; y: number } | 'all' | null;

/** raw 478×3 MediaPipe landmarks in O-space (adapt() derives Face on load); box = oval bbox */
export interface CachedFace {
  id: string;
  lm: Float32Array;
  box: Rect;
}
/** a face dropped by the size filter or the cap: no effects, but it bounds its neighbours' caps (≈ 300 B) */
export interface CachedObstacle {
  box: Rect;
  /** the 36-point FACE_OVAL, O-space, length 72 */
  oval: Float32Array;
}
export interface CachedBody {
  id: string;
  pose: Pose33;
  mask: PersonMask | null;
  /** selectPerson's area × centrality */
  score: number;
}
export interface PersonInfoCached {
  id: PersonId;
  face: string | null;
  body: string | null;
}
export interface DetectionCache {
  v: 1;
  /** pixel size of the image the normalized coordinates were taken on (aspect check) */
  width: number;
  height: number;
  /** step 1 writes [{quarter: 0, flipH: false}] after a definite answer, [] in 基本模式 */
  faceScans: { quarter: 0 | 1 | 2 | 3; flipH: boolean }[];
  /** O-space, sorted by box centre x then y */
  faces: CachedFace[];
  obstacles: CachedObstacle[];
  /** null = 美體 detection not run yet */
  bodies: CachedBody[] | null;
  /** false for a v0.3 cache with people ≥ 2: the others are unknown */
  bodiesComplete: boolean;
  /** display order: left to right when first built, later persons appended */
  persons: PersonInfoCached[];
  primary: PersonId;
  dropped: { tooSmall: number; overCap: number };
}
/** BodyTracker.detect result: every person (BodyDetection stays the v1 storage shape) */
export interface BodyDetections {
  bodies: { pose: Pose33; mask: PersonMask | null; score: number }[];
  width: number;
  height: number;
}
```

(`Pose33`, `PersonMask` are declared further down the same file; type declarations are hoisted.)

- [x] **Step 4: Scope and live on every def; export the band helpers**

`src/engine/params.ts`: replace `PARAM_DEFS` (`:4-37`) with:

```ts
export const PARAM_DEFS: readonly ParamDef[] = [
  // 美膚 — 美白 / 銳化 are photo-level (the GPUPixel chain is not masked, composite.ts); 磨皮 / 紅潤 per person
  { id: 'skin.smooth', label: '磨皮', group: 'skin', bidirectional: false, default: 0.55, icon: 'smooth', scope: 'person', live: true },
  { id: 'skin.whiten', label: '美白', group: 'skin', bidirectional: false, default: 0.25, icon: 'whiten', scope: 'photo', live: true },
  { id: 'skin.rosy', label: '紅潤', group: 'skin', bidirectional: false, default: 0.25, icon: 'rosy', scope: 'person', live: true },
  { id: 'skin.sharpen', label: '銳化', group: 'skin', bidirectional: false, default: 0.2, icon: 'sharpen', scope: 'photo', live: true },
  // 美型
  { id: 'shape.eyeEnlarge', label: '大眼', group: 'shape', bidirectional: false, default: 0.2, icon: 'eye', scope: 'person', live: true },
  { id: 'shape.faceSlim', label: '瘦臉', group: 'shape', bidirectional: false, default: 0.15, icon: 'faceSlim', scope: 'person', live: true },
  { id: 'shape.faceV', label: 'V臉', group: 'shape', bidirectional: false, default: 0.1, icon: 'faceV', scope: 'person', live: true },
  { id: 'shape.faceNarrow', label: '窄臉', group: 'shape', bidirectional: false, default: 0, icon: 'faceNarrow', scope: 'person', live: true },
  { id: 'shape.chin', label: '下巴', group: 'shape', bidirectional: true, default: 0.5, icon: 'chin', scope: 'person', live: true },
  { id: 'shape.forehead', label: '額頭', group: 'shape', bidirectional: true, default: 0.5, icon: 'forehead', scope: 'person', live: true },
  { id: 'shape.noseSlim', label: '瘦鼻', group: 'shape', bidirectional: false, default: 0.1, icon: 'nose', scope: 'person', live: true },
  { id: 'shape.mouthSize', label: '嘴型', group: 'shape', bidirectional: true, default: 0.5, icon: 'mouth', scope: 'person', live: true },
  { id: 'shape.eyeDistance', label: '眼距', group: 'shape', bidirectional: true, default: 0.5, icon: 'eyeDistance', scope: 'person', live: true },
  // 美體 — all neutral by default and never part of a preset (body research report §參數). 長腿 is a row band, so
  // photo-level; the local items are per person. Editor only (live: false).
  // Order follows the recommended adjustment sequence: length first, then body/limbs, shoulders/neck last.
  { id: 'body.legs', label: '長腿', group: 'body', bidirectional: false, default: 0, icon: 'legs', scope: 'photo', live: false },
  { id: 'body.slim', label: '瘦身', group: 'body', bidirectional: false, default: 0, icon: 'bodySlim', scope: 'person', live: false },
  { id: 'body.waist', label: '細腰', group: 'body', bidirectional: false, default: 0, icon: 'waist', scope: 'person', live: false },
  { id: 'body.whr', label: '腰臀比', group: 'body', bidirectional: false, default: 0, icon: 'whr', scope: 'person', live: false },
  { id: 'body.hip', label: '美臀', group: 'body', bidirectional: true, default: 0.5, icon: 'hip', scope: 'person', live: false },
  { id: 'body.legSlim', label: '瘦腿', group: 'body', bidirectional: false, default: 0, icon: 'legSlim', scope: 'person', live: false },
  { id: 'body.arms', label: '瘦手臂', group: 'body', bidirectional: false, default: 0, icon: 'arms', scope: 'person', live: false },
  { id: 'body.shoulder', label: '直角肩', group: 'body', bidirectional: false, default: 0, icon: 'shoulder', scope: 'person', live: false },
  { id: 'body.neck', label: '天鵝頸', group: 'body', bidirectional: false, default: 0, icon: 'neck', scope: 'person', live: false },
  { id: 'body.head', label: '小頭', group: 'body', bidirectional: false, default: 0, icon: 'head', scope: 'person', live: false },
  // 濾鏡
  { id: 'filter.amount', label: '濾鏡強度', group: 'filter', bidirectional: false, default: 0.5, icon: 'filter', scope: 'photo', live: true },
  // 美妝
  { id: 'makeup.lip', label: '口紅', group: 'makeup', bidirectional: false, default: 0, icon: 'lip', scope: 'person', live: true },
  { id: 'makeup.blush', label: '腮紅', group: 'makeup', bidirectional: false, default: 0, icon: 'blush', scope: 'person', live: true },
];
```

Change `function cleanBand(` (`:211`) to `export function cleanBand(` and `function sanitizeBand(` (`:313`) to `export function sanitizeBand(`.

- [x] **Step 5: Write `src/edit/state.ts` (constructors)**

```ts
// The v0.4 edit of one photo (RM §3.2–3.4): an immutable EditState with a photo layer and a person layer. Every change
// returns a new object and shares what it did not change, so UndoStack keeps states by reference ({clone: false}).
import { applyPreset, PARAM_DEFS } from '../engine/params';
import { stableKey } from '../store/undo';
import type { CameraLook, EditState, PersonId, PersonParamId, PersonParams, PhotoParamId, PhotoParams, PresetId } from '../types';

export const P0: PersonId = 'p0';
export const LIVE: PersonId = 'live';
/** every id a person may carry (S §5.4) */
export const PERSON_ID = /^(f[0-5]|b[0-3]|p0|live)$/;
export const PHOTO_IDS: readonly PhotoParamId[] = PARAM_DEFS.filter((d) => d.scope === 'photo').map((d) => d.id as PhotoParamId);
export const PERSON_IDS: readonly PersonParamId[] = PARAM_DEFS.filter((d) => d.scope === 'person').map((d) => d.id as PersonParamId);
/** a beauty preset's person part: every person-level face item (RM §3.4); 美體 is never in a preset */
export const PRESET_PERSON_IDS: readonly PersonParamId[] = PERSON_IDS.filter((id) => !id.startsWith('body.'));
/** a beauty preset's photo part (besides filterId) */
export const PRESET_PHOTO_IDS: readonly PhotoParamId[] = ['skin.whiten', 'skin.sharpen', 'filter.amount'];

/** the person part of preset `id` at 程度 `amount`, every 美體 item neutral */
export function personFromPreset(id: PresetId, amount: number): PersonParams {
  const p = applyPreset(id, amount);
  const values = {} as Record<PersonParamId, number>;
  for (const k of PERSON_IDS) values[k] = p.values[k];
  return { values, shades: { lip: p.lipShade, blush: p.blushShade }, preset: { id, amount: p.presetAmount } };
}

/** 原圖: every value neutral (the template of persons the camera did not beautify) */
export function neutralPerson(): PersonParams {
  return personFromPreset('original', 1);
}

/** 自然 100: what 重置 gives every person */
export function naturalPerson(): PersonParams {
  return personFromPreset('natural', 1);
}

/** the 自然 photo part, everything else neutral or identity (重置, RM §3.4) */
export function defaultPhoto(): PhotoParams {
  const p = applyPreset('natural', 1);
  const values = {} as Record<PhotoParamId, number>;
  for (const k of PHOTO_IDS) values[k] = p.values[k];
  return { values, filterId: p.filterId, presetLink: { id: 'natural', amount: 1 }, bodyProtect: true, heightBand: null, legsAnchor: null };
}

/** The output de-dupe and undo key (RM §3.4; step 6 replaces stroke points by stroke ids here). */
export function editKey(edit: EditState): string {
  return stableKey(edit);
}

/** a person's params, or the template for a person the edit does not list yet */
export function personOf(edit: EditState, id: PersonId): PersonParams {
  return edit.persons[id] ?? edit.template;
}

export function withPhoto(edit: EditState, f: (p: PhotoParams) => PhotoParams): EditState {
  const photo = f(edit.photo);
  return photo === edit.photo ? edit : { ...edit, photo };
}

/** `f` applied to each listed person (a person the edit lacks starts from the template); the others are shared */
export function withPersons(edit: EditState, ids: readonly PersonId[], f: (p: PersonParams, id: PersonId) => PersonParams): EditState {
  if (!ids.length) return edit;
  const persons: Record<PersonId, PersonParams> = { ...edit.persons };
  for (const id of ids) persons[id] = f(personOf(edit, id), id);
  return { ...edit, persons };
}

/** the camera's edit: one person, 'live' (RM §3.7) */
export function cameraEdit(look: CameraLook): EditState {
  return { v: 2, photo: look.photo, persons: { [LIVE]: look.person }, template: look.person, primaryInit: null };
}

export function lookOf(edit: EditState): CameraLook {
  return { photo: edit.photo, person: personOf(edit, LIVE) };
}
```

- [x] **Step 6: Write `src/edit/legacy.ts`**

```ts
// v1 (BeautyParams, the 0.3 storage shape) ↔ v2 (EditState), RM §3.2 / §5. BeautyParams stays the shape of history v1
// records and meiyan.params.v1, and of the legacy projection 0.4 keeps writing so a rollback to 0.3 still opens 0.4
// entries with the primary person's look. New code never takes BeautyParams.
import type { BeautyParams, EditState, ParamId, PersonId, PersonParamId, PersonParams, PhotoParamId, PhotoParams } from '../types';
import { neutralPerson, P0, PERSON_IDS, PHOTO_IDS } from './state';

export function splitLegacy(p: BeautyParams): { photo: PhotoParams; person: PersonParams } {
  const ref = p.presetId === 'custom' ? null : { id: p.presetId, amount: p.presetAmount };
  const photoValues = {} as Record<PhotoParamId, number>;
  for (const id of PHOTO_IDS) photoValues[id] = p.values[id];
  const personValues = {} as Record<PersonParamId, number>;
  for (const id of PERSON_IDS) personValues[id] = p.values[id];
  return {
    photo: { values: photoValues, filterId: p.filterId, presetLink: ref, bodyProtect: p.bodyProtect, heightBand: p.heightBand, legsAnchor: null },
    person: { values: personValues, shades: { lip: p.lipShade, blush: p.blushShade }, preset: ref ?? 'custom' },
  };
}

/**
 * The 0.3 view of an edit: the photo plus one person (`primary`, else primaryInit, else the template). presetId stands
 * only while the person's preset and the photo's preset link agree; otherwise 'custom' with 程度 1 (dead data in 0.3).
 */
export function legacyProjection(edit: EditState, primary: PersonId): BeautyParams {
  const person = edit.persons[primary] ?? edit.primaryInit ?? edit.template;
  const ref = person.preset;
  const link = edit.photo.presetLink;
  const linked = ref !== 'custom' && link !== null && link.id === ref.id && link.amount === ref.amount;
  return {
    values: { ...edit.photo.values, ...person.values } as Record<ParamId, number>,
    filterId: edit.photo.filterId,
    lipShade: person.shades.lip,
    blushShade: person.shades.blush,
    presetId: linked ? ref.id : 'custom',
    presetAmount: linked ? ref.amount : 1,
    bodyProtect: edit.photo.bodyProtect,
    heightBand: edit.photo.heightBand,
  };
}

/** One implicit person `p0` carrying `p`; v1 entries also keep it as primaryInit (RM §5.2). */
export function editFromLegacy(p: BeautyParams, opts: { primaryInit?: boolean } = {}): EditState {
  const { photo, person } = splitLegacy(p);
  return { v: 2, photo, persons: { [P0]: person }, template: neutralPerson(), primaryInit: opts.primaryInit ? person : null };
}
```

- [x] **Step 7: Run the tests**

Run: `npx vitest run src/edit src/engine/params.test.ts && npm run typecheck`
Expected: PASS; `tsc` exits 0 (nothing reads `scope` / `live` yet; the harnesses build `ParamDef`s only through `PARAM_DEFS`).

- [x] **Step 8: Commit**

```bash
git add src/types.ts src/engine/params.ts src/edit/state.ts src/edit/legacy.ts src/edit/state.test.ts src/edit/legacy.test.ts
git commit -m "v0.4 step 1b: EditState types, scope/live table, constructors, splitLegacy/legacyProjection"
```

---

### Task 5: `assignPersons`, `renamePersons`, 重置 and `sanitizeEditState`

**Files:**
- Modify: `src/edit/state.ts` (append), `src/edit/state.test.ts` (append)

**Interfaces:**
- Consumes: Task 4 (`P0`, `PERSON_ID`, `PHOTO_IDS`, `PERSON_IDS`, `PRESET_PERSON_IDS`, `PRESET_PHOTO_IDS`, `personFromPreset`, `neutralPerson`, `naturalPerson`, `defaultPhoto`); `applyPreset`, `FILTERS`, `LIP_SHADES`, `BLUSH_SHADES`, `PRESETS`, `sanitizeBand` (`params.ts`).
- Produces: `assignPersons(edit: EditState, ids: readonly PersonId[], primary: PersonId, opts?: { discardP0?: boolean }): EditState`; `renamePersons(edit: EditState, map: Readonly<Record<PersonId, PersonId | null>>): EditState`; `resetAll(edit: EditState): EditState`; `matchesPersonPreset(p: PersonParams, ref: PresetRef): boolean`; `matchesPhotoLink(photo: PhotoParams, ref: PresetRef): boolean`; `sanitizePerson(raw: unknown, fallback: PersonParams): PersonParams`; `sanitizePhoto(raw: unknown, persons?: ReadonlySet<PersonId> | null): PhotoParams`; `isEditStateRecord(raw: unknown): boolean`; `sanitizeEditState(raw: unknown, personIds: readonly PersonId[] | null): EditState`. Steps 3, 4 and 6 add an optional third parameter `oSize` (RM §3.2); keep the first two.

- [x] **Step 1: Write the failing tests** (append to `src/edit/state.test.ts`; add `assignPersons, isEditStateRecord, renamePersons, resetAll, sanitizeEditState` to the `./state` import and `import type { EditState } from '../types';`)

```ts
const edit0 = (over: Partial<EditState> = {}): EditState => ({
  v: 2,
  photo: defaultPhoto(),
  persons: { p0: { ...naturalPerson(), values: { ...naturalPerson().values, 'shape.eyeEnlarge': 0.8 }, preset: 'custom' } },
  template: neutralPerson(),
  primaryInit: naturalPerson(),
  ...over,
});

describe('assignPersons (S §3.3 item 4)', () => {
  it('gives p0 (the look plus every edit made meanwhile) to the primary and the template to everyone else', () => {
    const e = assignPersons(edit0(), ['f0', 'f1', 'f2'], 'f1');
    expect(Object.keys(e.persons)).toEqual(['f0', 'f1', 'f2']);
    expect(e.persons.f1.values['shape.eyeEnlarge']).toBe(0.8);
    expect(e.persons.f0).toEqual(neutralPerson());
    expect(e.primaryInit).toBeNull();
  });
  it('keeps persons it already has and keeps p0 when nobody was found', () => {
    const known = assignPersons(edit0(), ['f0'], 'f0');
    const more = assignPersons(known, ['f0', 'b1'], 'f0');
    expect(more.persons.f0).toBe(known.persons.f0);
    expect(more.persons.b1).toEqual(neutralPerson());
    const none = assignPersons(edit0(), ['p0'], 'p0');
    expect(Object.keys(none.persons)).toEqual(['p0']);
    expect(none.persons.p0.values['shape.eyeEnlarge']).toBe(0.8);
  });
  it('a 長腿 anchor on p0 follows p0 to the primary; discardP0 starts everyone from the template', () => {
    const e = edit0({ photo: { ...defaultPhoto(), legsAnchor: 'p0' } });
    expect(assignPersons(e, ['f0', 'f1'], 'f1').photo.legsAnchor).toBe('f1');
    expect(assignPersons(e, ['f0', 'f1'], 'f1', { discardP0: true }).persons.f1).toEqual(neutralPerson());
  });
  it('without p0 the primary starts from primaryInit (a camera shot), else the template', () => {
    expect(assignPersons({ ...edit0(), persons: {} }, ['f0', 'f1'], 'f0').persons.f0).toEqual(naturalPerson());
  });
});

describe('renamePersons (S §5.3 dropped cache)', () => {
  it('renames, drops unmatched (null) and lets the 長腿 anchor follow', () => {
    const e = assignPersons(edit0({ photo: { ...defaultPhoto(), legsAnchor: 'f1' } }), ['f0', 'f1'], 'f1');
    const r = renamePersons(e, { f1: 'f0', f0: null });
    expect(Object.keys(r.persons)).toEqual(['f0']);
    expect(r.persons.f0.values['shape.eyeEnlarge']).toBe(0.8);
    expect(r.photo.legsAnchor).toBe('f0');
  });
});

describe('resetAll (重置)', () => {
  it('sets the 自然 photo part and every person to 自然; keeps the template', () => {
    const e = resetAll(assignPersons(edit0(), ['f0', 'f1'], 'f0'));
    expect(e.photo).toEqual(defaultPhoto());
    expect(e.persons.f0).toEqual(naturalPerson());
    expect(e.persons.f1).toEqual(naturalPerson());
    expect(e.template).toEqual(neutralPerson());
  });
});

describe('sanitizeEditState (RM §3.4)', () => {
  function rng(seed: number) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), a | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const KEYS = ['v', 'photo', 'persons', 'template', 'primaryInit', 'values', 'shades', 'preset', 'lip', 'blush', 'f0', 'p0', 'zz', 'id', 'amount', 'skin.smooth', 'skin.whiten', 'filterId', 'presetLink', 'legsAnchor', 'heightBand'];
  const junk = (r: () => number, depth = 0): unknown => {
    const k = Math.floor(r() * 9);
    if (depth > 3 || k < 3) return [NaN, Infinity, -1, 2, 0.5, 'x', null, true][Math.floor(r() * 8)];
    if (k < 5) return Array.from({ length: Math.floor(r() * 3) }, () => junk(r, depth + 1));
    return Object.fromEntries(Array.from({ length: 1 + Math.floor(r() * 5) }, () => [KEYS[Math.floor(r() * KEYS.length)], junk(r, depth + 1)]));
  };
  it('turns 2000 random records into valid, idempotent states', () => {
    const r = rng(9);
    for (let i = 0; i < 2000; i++) {
      const s = sanitizeEditState(junk(r), r() < 0.5 ? null : ['f0', 'p0']);
      for (const p of [s.template, ...Object.values(s.persons)]) for (const v of Object.values(p.values)) expect(v >= 0 && v <= 1).toBe(true);
      for (const v of Object.values(s.photo.values)) expect(v >= 0 && v <= 1).toBe(true);
      for (const id of Object.keys(s.persons)) expect(/^(f[0-5]|b[0-3]|p0|live)$/.test(id)).toBe(true);
      expect(sanitizeEditState(s, Object.keys(s.persons))).toEqual(s);
    }
  });
  it('drops persons not in the list, adds missing ones from the template, keeps all with null', () => {
    const e = assignPersons(edit0(), ['f0', 'f1'], 'f0');
    expect(Object.keys(sanitizeEditState(e, ['f1', 'b0']).persons).sort()).toEqual(['b0', 'f1']);
    expect(sanitizeEditState(e, ['f1', 'b0']).persons.b0).toEqual(e.template);
    expect(Object.keys(sanitizeEditState(e, null).persons).sort()).toEqual(['f0', 'f1']);
  });
  it('keeps a preset id only while the values still match it', () => {
    const p = naturalPerson();
    const off = { ...p, values: { ...p.values, 'shape.chin': 0.9 } };
    const s = sanitizeEditState({ ...edit0(), persons: { f0: p, f1: off } }, null);
    expect(s.persons.f0.preset).toEqual({ id: 'natural', amount: 1 });
    expect(s.persons.f1.preset).toBe('custom');
  });
  it('fills a partial record from an intermediate dev build (Review Focus #5)', () => {
    const s = sanitizeEditState({ v: 2, photo: {}, persons: { p0: { values: { 'skin.smooth': 0.4 } } } }, null);
    expect(s.template).toEqual(neutralPerson());
    expect(s.primaryInit).toBeNull();
    expect(s.persons.p0.values['skin.smooth']).toBe(0.4);
    expect(s.persons.p0.values['shape.chin']).toBe(0.5);
    expect(s.persons.p0.shades).toEqual({ lip: null, blush: null });
    expect(s.photo.filterId).toBe('none');
    expect(isEditStateRecord({ v: 1, photo: {}, persons: {} })).toBe(false);
    expect(isEditStateRecord({ v: 2, photo: {}, persons: {} })).toBe(true);
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `npx vitest run src/edit/state.test.ts`
Expected: FAIL (`assignPersons is not a function` etc.).

- [x] **Step 3: Implement** (append to `src/edit/state.ts`; extend its imports to `import { applyPreset, BLUSH_SHADES, FILTERS, LIP_SHADES, PARAM_DEFS, PRESETS, sanitizeBand } from '../engine/params';` and add `PresetRef`, `ShadePart` to the type import)

```ts
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const PRESET_IDS: ReadonlySet<string> = new Set(PRESETS.map((p) => p.id));
const SHADES: Record<ShadePart, ReadonlySet<string>> = {
  lip: new Set(LIP_SHADES.map((s) => s.id)),
  blush: new Set(BLUSH_SHADES.map((s) => s.id)),
};

/**
 * The persons known now (display order) get their params (S §3.3 item 4): a person the edit has keeps its params; the
 * primary gets p0 (primaryInit plus every edit made meanwhile), else primaryInit, else the template; everyone else the
 * template. p0 stays only when it is the whole list (nobody found). `discardP0`: a camera seed matched no face, so the
 * look must not land on a face the camera did not beautify (S §3.4 C2). primaryInit becomes null.
 */
export function assignPersons(edit: EditState, ids: readonly PersonId[], primary: PersonId, opts: { discardP0?: boolean } = {}): EditState {
  const seed = opts.discardP0 ? edit.template : (edit.persons[P0] ?? edit.primaryInit ?? edit.template);
  const persons: Record<PersonId, PersonParams> = {};
  for (const id of ids) {
    const have = id === P0 ? undefined : edit.persons[id];
    persons[id] = have ?? (id === primary || id === P0 ? seed : edit.template);
  }
  const anchor = edit.photo.legsAnchor;
  const handed = edit.persons[P0] !== undefined && !ids.includes(P0);
  let legsAnchor = anchor;
  if (anchor === P0) legsAnchor = handed ? primary : ids.includes(P0) ? P0 : null;
  else if (anchor !== null && !ids.includes(anchor)) legsAnchor = null;
  const photo = legsAnchor === anchor ? edit.photo : { ...edit.photo, legsAnchor };
  return { ...edit, photo, persons, primaryInit: null };
}

/** old → new person ids (null = drop); persons absent from `map` keep their id; the 長腿 anchor follows (S §5.3) */
export function renamePersons(edit: EditState, map: Readonly<Record<PersonId, PersonId | null>>): EditState {
  const persons: Record<PersonId, PersonParams> = {};
  for (const [id, p] of Object.entries(edit.persons)) {
    const to = id in map ? map[id] : id;
    if (to !== null && !(to in persons)) persons[to] = p;
  }
  const la = edit.photo.legsAnchor;
  const legsAnchor = la === null ? null : la in map ? map[la] : la;
  return { ...edit, persons, photo: legsAnchor === la ? edit.photo : { ...edit.photo, legsAnchor } };
}

/** 重置 (RM §3.4): the 自然 photo part, every person 自然; the template stays. One undo step. */
export function resetAll(edit: EditState): EditState {
  const persons: Record<PersonId, PersonParams> = {};
  for (const id of Object.keys(edit.persons)) persons[id] = naturalPerson();
  return { ...edit, photo: defaultPhoto(), persons };
}

/** the person part of `ref` (face items within 1e-6, lip / blush shades) is what `p` holds (RM §3.4 matching) */
export function matchesPersonPreset(p: PersonParams, ref: PresetRef): boolean {
  const q = personFromPreset(ref.id, ref.amount);
  if (q.shades.lip !== p.shades.lip || q.shades.blush !== p.shades.blush) return false;
  return PRESET_PERSON_IDS.every((id) => Math.abs(q.values[id] - p.values[id]) < 1e-6);
}

/** the photo part of `ref` (美白, 銳化, 濾鏡強度, filterId) is what `photo` holds */
export function matchesPhotoLink(photo: PhotoParams, ref: PresetRef): boolean {
  const q = applyPreset(ref.id, ref.amount);
  if (q.filterId !== photo.filterId) return false;
  return PRESET_PHOTO_IDS.every((id) => Math.abs(q.values[id] - photo.values[id]) < 1e-6);
}

function presetRefOf(raw: unknown): PresetRef | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !PRESET_IDS.has(raw.id)) return null;
  if (typeof raw.amount !== 'number' || !Number.isFinite(raw.amount)) return null;
  return { id: raw.id as PresetId, amount: clamp01(raw.amount) };
}

/** Untrusted person → valid: values clamped, a missing field from `fallback`, shades validated, preset kept only if matching. */
export function sanitizePerson(raw: unknown, fallback: PersonParams): PersonParams {
  const r = isRecord(raw) ? raw : {};
  const rv = isRecord(r.values) ? r.values : {};
  const values = {} as Record<PersonParamId, number>;
  for (const id of PERSON_IDS) {
    const v = rv[id];
    values[id] = typeof v === 'number' && Number.isFinite(v) ? clamp01(v) : fallback.values[id];
  }
  const rs = isRecord(r.shades) ? r.shades : null;
  const shade = (part: ShadePart): string | null => {
    if (!rs || !(part in rs)) return fallback.shades[part];
    const s = rs[part];
    return typeof s === 'string' && SHADES[part].has(s) ? s : null;
  };
  const shades = { lip: shade('lip'), blush: shade('blush') };
  const ref = presetRefOf('preset' in r ? r.preset : fallback.preset);
  const preset = ref && matchesPersonPreset({ values, shades, preset: ref }, ref) ? ref : 'custom';
  return { values, shades, preset };
}

/** Untrusted photo layer → valid; `persons` (when known) bounds the 長腿 anchor; a link survives only while it matches. */
export function sanitizePhoto(raw: unknown, persons: ReadonlySet<PersonId> | null = null): PhotoParams {
  const base = defaultPhoto();
  const r = isRecord(raw) ? raw : {};
  const rv = isRecord(r.values) ? r.values : {};
  const values = { ...base.values };
  for (const id of PHOTO_IDS) {
    const v = rv[id];
    if (typeof v === 'number' && Number.isFinite(v)) values[id] = clamp01(v);
  }
  const la = r.legsAnchor;
  const photo: PhotoParams = {
    values,
    filterId: FILTERS.some((f) => f.id === r.filterId) ? (r.filterId as string) : 'none',
    presetLink: presetRefOf(r.presetLink),
    bodyProtect: typeof r.bodyProtect === 'boolean' ? r.bodyProtect : true,
    heightBand: sanitizeBand(r.heightBand),
    legsAnchor: typeof la === 'string' && PERSON_ID.test(la) && (!persons || persons.has(la)) ? la : null,
  };
  if (photo.presetLink && !matchesPhotoLink(photo, photo.presetLink)) photo.presetLink = null;
  return photo;
}

/** a stored v2 edit worth sanitizing (otherwise the entry opens as v1, from `params`) */
export function isEditStateRecord(raw: unknown): boolean {
  return isRecord(raw) && raw.v === 2 && isRecord(raw.photo) && isRecord(raw.persons);
}

/**
 * Untrusted edit → valid EditState (RM §3.4): values clamped to 0..1, filter / shade / preset ids validated, a preset
 * id kept only while the values match it. `personIds` (the detection cache's persons) drops persons not in it and
 * adds missing ones from the template; null (no cache, or one dropped for a rematch) keeps every valid person.
 */
export function sanitizeEditState(raw: unknown, personIds: readonly PersonId[] | null): EditState {
  const r = isRecord(raw) ? raw : {};
  const template = sanitizePerson(r.template, neutralPerson());
  const primaryInit = r.primaryInit === undefined || r.primaryInit === null ? null : sanitizePerson(r.primaryInit, template);
  const persons: Record<PersonId, PersonParams> = {};
  const rp = isRecord(r.persons) ? r.persons : {};
  for (const [id, p] of Object.entries(rp)) {
    if (!PERSON_ID.test(id) || (personIds && !personIds.includes(id))) continue;
    persons[id] = sanitizePerson(p, template);
  }
  if (personIds) {
    for (const id of personIds) if (!persons[id]) persons[id] = id === P0 ? (primaryInit ?? template) : template;
  } else if (!Object.keys(persons).length) persons[P0] = primaryInit ?? template;
  return { v: 2, photo: sanitizePhoto(r.photo, new Set(Object.keys(persons))), persons, template, primaryInit };
}
```

- [x] **Step 4: Run the tests**

Run: `npx vitest run src/edit`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/edit/state.ts src/edit/state.test.ts
git commit -m "v0.4 step 1b: assignPersons, renamePersons, 重置, sanitizeEditState"
```

---

### Task 6: The lens (`src/edit/lens.ts`)

**Files:**
- Create: `src/edit/lens.ts`, `src/edit/lens.test.ts`

**Interfaces:**
- Consumes: Tasks 4–5 (`personOf`, `withPersons`, `withPhoto`, `resetAll`, `PRESET_PERSON_IDS`, `PRESET_PHOTO_IDS`); `applyPreset`, `cleanBand`, `displayValue`, `FILTERS`, `hasValue`, `MAKEUP_PICK_DEFAULT`, `neutralValue`, `paramDef`, `paramsInGroup` (`params.ts`).
- Produces (all consumed by Tasks 10, 12, 21, 22, 23, 25):

```ts
export const NO_FACE_NOTE = '這位人物未偵測到臉部，臉部效果不適用';
export const NO_BODY_NOTE = '這位人物未偵測到身體，僅能使用增高、長腿';
export const NO_FACE_PHOTO_NOTE = '未偵測到臉部，臉型與美妝不會套用';
export interface PersonInfo { id: PersonId; face: boolean; body: boolean }
export interface LensOptions { available?(person: PersonId, id: ParamId): boolean }
export interface Lens {
  readonly edit: EditState; readonly sel: Selection; readonly persons: readonly PersonInfo[]; readonly primary: PersonId;
  readonly noFace: boolean;
  targets(id: ParamId): PersonId[];          // person ids a person item writes; [] for photo items and refusals
  faceTargets(): PersonId[];                 // presets, shades, 無
  get(id: ParamId): { value: number; mixed: boolean };
  set(id: ParamId, v: number): EditState;
  applies(id: ParamId): RegionStatus;
  shade(part: ShadePart): { shade: string | null; on: boolean; mixed: boolean };
  preset(): { ref: PresetRef | 'custom' | null; mixed: boolean };
  setShade(part: ShadePart, shade: string | null): EditState;
  clearMakeup(part: ShadePart): EditState;
  applyPreset(id: PresetId, amount: number): EditState;
  setPresetAmount(amount: number): EditState;
  setFilter(filterId: string): EditState;
  setBodyProtect(on: boolean): EditState;
  setHeightBand(band: HeightBand | null): EditState;
  resetGroup(group: ParamGroup): EditState;
  groupNeutral(group: ParamGroup): boolean;
  groupHasValue(group: ParamGroup): boolean;
  reset(): EditState;
}
export function lensFor(edit: EditState, sel: Selection, persons: readonly PersonInfo[], primary: PersonId, opts?: LensOptions): Lens;
export const P0_INFO: readonly PersonInfo[];   // [{id: 'p0', face: true, body: true}]
```

Step 2 adds `setLook` (RM §3.3); nothing in step 1 depends on it.

- [x] **Step 1: Write the failing tests**

```ts
// src/edit/lens.test.ts
import { describe, expect, it } from 'vitest';
import { applyPreset, LIP_SHADES, setFilter, setParam, setShade } from '../engine/params';
import type { BeautyParams, EditState } from '../types';
import { editFromLegacy, legacyProjection } from './legacy';
import { lensFor, NO_BODY_NOTE, NO_FACE_NOTE, P0_INFO, type PersonInfo } from './lens';
import { assignPersons, defaultPhoto, naturalPerson, neutralPerson, personFromPreset } from './state';

const three: PersonInfo[] = [
  { id: 'f0', face: true, body: true },
  { id: 'f1', face: true, body: false },
  { id: 'b0', face: false, body: true },
];
function group(): EditState {
  const e: EditState = { v: 2, photo: defaultPhoto(), persons: { p0: naturalPerson() }, template: neutralPerson(), primaryInit: null };
  return assignPersons(e, ['f0', 'f1', 'b0'], 'f0');
}
const one = (id: string) => ({ kind: 'person' as const, id });
const all = { kind: 'all' as const };

describe('lens routing (RM §3.3)', () => {
  it('photo items write the photo whatever the selection; 美白 breaks the preset link only', () => {
    const e = lensFor(group(), one('f1'), three, 'f0').set('skin.whiten', 0.9);
    expect(e.photo.values['skin.whiten']).toBe(0.9);
    expect(e.photo.presetLink).toBeNull();
    expect(e.persons.f1.preset).toEqual({ id: 'original', amount: 1 });
  });
  it('a person item writes the selected person only, and marks its preset custom', () => {
    const e0 = group();
    const e = lensFor(e0, one('f1'), three, 'f0').set('shape.eyeEnlarge', 0.7);
    expect(e.persons.f1.values['shape.eyeEnlarge']).toBe(0.7);
    expect(e.persons.f1.preset).toBe('custom');
    expect(e.persons.f0).toBe(e0.persons.f0);
  });
  it('refuses face items for a body-only person and local body items for a face-only person, with the notes', () => {
    const l = lensFor(group(), one('b0'), three, 'f0');
    expect(l.set('shape.eyeEnlarge', 0.7)).toBe(l.edit);
    expect(l.applies('skin.smooth')).toEqual({ ok: false, reason: NO_FACE_NOTE });
    expect(lensFor(group(), one('f1'), three, 'f0').applies('body.waist')).toEqual({ ok: false, reason: NO_BODY_NOTE });
    expect(lensFor(group(), one('f1'), three, 'f0').applies('body.legs').ok).toBe(true);
  });
  it('全部 writes every applicable person and reads the primary; mixed compares display values', () => {
    const e = lensFor(group(), all, three, 'f0').set('shape.faceSlim', 0.6);
    expect([e.persons.f0, e.persons.f1].map((p) => p.values['shape.faceSlim'])).toEqual([0.6, 0.6]);
    expect(e.persons.b0.values['shape.faceSlim']).toBe(0);
    const near = lensFor(e, one('f1'), three, 'f0').set('shape.faceSlim', 0.6049);
    expect(lensFor(near, all, three, 'f0').get('shape.faceSlim')).toEqual({ value: 0.6, mixed: false });
    const far = lensFor(e, one('f1'), three, 'f0').set('shape.faceSlim', 0.3451);
    expect(lensFor(far, all, three, 'f0').get('shape.faceSlim').mixed).toBe(true);
  });
  it('under 全部, a primary that does not apply reads the first applicable person', () => {
    const e = lensFor(group(), one('b0'), three, 'f0').set('body.waist', 0.4);
    expect(lensFor(e, all, three, 'f1').get('body.waist').value).toBe(0);
    expect(lensFor(e, all, [three[1], three[2]], 'f1').get('body.waist').value).toBe(0.4);
  });
  it('a photo with no face: 磨皮 and 紅潤 read and write the primary (all skin); 美型 is refused', () => {
    const p0: PersonInfo[] = [{ id: 'p0', face: false, body: false }];
    const e: EditState = { v: 2, photo: defaultPhoto(), persons: { p0: naturalPerson() }, template: neutralPerson(), primaryInit: null };
    const l = lensFor(e, one('p0'), p0, 'p0');
    expect(l.noFace).toBe(true);
    expect(l.set('skin.smooth', 0.9).persons.p0.values['skin.smooth']).toBe(0.9);
    expect(l.applies('shape.chin').ok).toBe(false);
  });
  it('長腿 records the anchor: the selected body person, null under 全部 or for a person without a body', () => {
    expect(lensFor(group(), one('f0'), three, 'f0').set('body.legs', 0.5).photo.legsAnchor).toBe('f0');
    expect(lensFor(group(), one('f1'), three, 'f0').set('body.legs', 0.5).photo.legsAnchor).toBeNull();
    expect(lensFor(group(), all, three, 'f0').set('body.legs', 0.5).photo.legsAnchor).toBeNull();
  });
});

describe('presets and 程度 (RM §3.4)', () => {
  it('apply: the person part to the targets, the photo part to the photo with the link', () => {
    const e = lensFor(group(), one('f1'), three, 'f0').applyPreset('refined', 0.6);
    expect(e.persons.f1.preset).toEqual({ id: 'refined', amount: 0.6 });
    expect(e.persons.f0.preset).toEqual({ id: 'natural', amount: 1 });
    expect(e.photo.filterId).toBe('soft');
    expect(e.photo.presetLink).toEqual({ id: 'refined', amount: 0.6 });
    expect(e.persons.f1.values['shape.eyeEnlarge']).toBeCloseTo(personFromPreset('refined', 0.6).values['shape.eyeEnlarge']);
  });
  it('a body-only person: presets change the photo part only', () => {
    const e0 = group();
    const e = lensFor(e0, one('b0'), three, 'f0').applyPreset('glow', 1);
    expect(e.persons).toBe(e0.persons);
    expect(e.photo.presetLink).toEqual({ id: 'glow', amount: 1 });
  });
  it('程度 rescales the person part; the photo part only while the link holds', () => {
    const l = lensFor(lensFor(group(), all, three, 'f0').applyPreset('refined', 1), all, three, 'f0');
    const half = l.setPresetAmount(0.5);
    expect(half.persons.f0.preset).toEqual({ id: 'refined', amount: 0.5 });
    expect(half.photo.values['skin.whiten']).toBeCloseTo(0.15);
    const unlinked = lensFor(l.set('skin.whiten', 0.9), all, three, 'f0').setPresetAmount(0.5);
    expect(unlinked.photo.values['skin.whiten']).toBe(0.9);
  });
  it('under 全部: 自然 reaches a person already at 精緻 although the primary is 自然; preset() is mixed', () => {
    const e = lensFor(group(), one('f1'), three, 'f0').applyPreset('refined', 1);
    const l = lensFor(e, all, three, 'f0');
    expect(l.preset().mixed).toBe(true);
    expect(l.applyPreset('natural', 1).persons.f1.preset).toEqual({ id: 'natural', amount: 1 });
  });
  it('shades under 全部: mixed until every face person matches', () => {
    const e = lensFor(group(), one('f0'), three, 'f0').setShade('lip', LIP_SHADES[0].id);
    const l = lensFor(e, all, three, 'f0');
    expect(l.shade('lip')).toMatchObject({ shade: LIP_SHADES[0].id, on: true, mixed: true });
    expect(lensFor(l.setShade('lip', LIP_SHADES[0].id), all, three, 'f0').shade('lip').mixed).toBe(false);
  });
});

describe('⊘ and 重置 (RM §2.1 notes)', () => {
  it('⊘ 美膚 on one person of a group leaves 美白 / 銳化 and the other persons', () => {
    const e0 = group();
    const e = lensFor(e0, one('f1'), three, 'f0').resetGroup('skin');
    expect(e.photo).toBe(e0.photo);
    expect(e.persons.f1.values['skin.smooth']).toBe(0);
    expect(e.persons.f0).toBe(e0.persons.f0);
  });
  it('⊘ under 全部, or with one person, also resets the photo items (v0.3 behaviour)', () => {
    expect(lensFor(group(), all, three, 'f0').resetGroup('skin').photo.values['skin.whiten']).toBe(0);
    const single: EditState = { v: 2, photo: defaultPhoto(), persons: { p0: naturalPerson() }, template: neutralPerson(), primaryInit: null };
    const r = lensFor(single, one('p0'), P0_INFO, 'p0').resetGroup('skin');
    expect(r.photo.values['skin.whiten']).toBe(0);
    expect(legacyProjection(r, 'p0').presetId).toBe('custom');
  });
  it('⊘ 美體 no-op check tests exactly its targets', () => {
    const e = lensFor(group(), one('b0'), three, 'f0').set('body.waist', 0.5);
    expect(lensFor(e, one('f0'), three, 'f0').groupNeutral('body')).toBe(true);
    expect(lensFor(e, one('b0'), three, 'f0').groupNeutral('body')).toBe(false);
  });
  it('重置 is every person 自然 and the 自然 photo part', () => {
    const e = lensFor(group(), all, three, 'f0').reset();
    expect(e.persons.f1).toEqual(naturalPerson());
    expect(e.photo).toEqual(defaultPhoto());
  });
});

describe('one person p0 is v0.3 (parity of every op through the projection)', () => {
  it('preset hop keeps 程度 and the body edits like applyPreset(id, amount, keep)', () => {
    const v1 = setParam(applyPreset('natural', 0.6), 'body.waist', 0.4);
    const e = editFromLegacy(v1);
    const l = lensFor(e, one('p0'), P0_INFO, 'p0');
    expect(legacyProjection(e, 'p0')).toEqual(v1);
    expect(legacyProjection(l.applyPreset('refined', 0.6), 'p0')).toEqual(applyPreset('refined', 0.6, v1));
    // presetAmount is dead data while custom: compare it canonicalized (legacy.test.ts)
    const canon = (p: BeautyParams): BeautyParams => (p.presetId === 'custom' ? { ...p, presetAmount: 1 } : p);
    expect(legacyProjection(l.set('shape.chin', 0.7), 'p0')).toEqual(canon(setParam(v1, 'shape.chin', 0.7)));
    expect(legacyProjection(l.set('body.hip', 0.7), 'p0')).toEqual(setParam(v1, 'body.hip', 0.7));
    expect(legacyProjection(l.setFilter('mono'), 'p0')).toEqual(canon(setFilter(v1, 'mono')));
    expect(legacyProjection(l.setShade('blush', 'peach'), 'p0')).toEqual(canon(setShade(v1, 'blush', 'peach')));
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `npx vitest run src/edit/lens.test.ts`
Expected: FAIL (cannot resolve `./lens`).

- [x] **Step 3: Write `src/edit/lens.ts`**

```ts
// One lens for every edit (RM §3.3): all panel reads and writes go through it, so the routing between the photo and
// the person layer, and between one person and 全部, lives in one place. The editor and the camera both use it.
import { applyPreset, cleanBand, displayValue, FILTERS, hasValue, MAKEUP_PICK_DEFAULT, neutralValue, paramDef, paramsInGroup } from '../engine/params';
import type {
  EditState,
  HeightBand,
  ParamGroup,
  ParamId,
  PersonId,
  PersonParams,
  PhotoParams,
  PresetId,
  PresetRef,
  RegionStatus,
  Selection,
  ShadePart,
} from '../types';
import { personOf, PRESET_PERSON_IDS, PRESET_PHOTO_IDS, resetAll, withPersons, withPhoto } from './state';

export const NO_FACE_NOTE = '這位人物未偵測到臉部，臉部效果不適用';
export const NO_BODY_NOTE = '這位人物未偵測到身體，僅能使用增高、長腿';
export const NO_FACE_PHOTO_NOTE = '未偵測到臉部，臉型與美妝不會套用';

export interface PersonInfo {
  id: PersonId;
  face: boolean;
  body: boolean;
}
export interface LensOptions {
  /** paramAvailability of a body item for that person's measure (absent → available) */
  available?(person: PersonId, id: ParamId): boolean;
}
export interface Lens {
  readonly edit: EditState;
  readonly sel: Selection;
  readonly persons: readonly PersonInfo[];
  readonly primary: PersonId;
  readonly noFace: boolean;
  targets(id: ParamId): PersonId[];
  faceTargets(): PersonId[];
  get(id: ParamId): { value: number; mixed: boolean };
  set(id: ParamId, v: number): EditState;
  applies(id: ParamId): RegionStatus;
  shade(part: ShadePart): { shade: string | null; on: boolean; mixed: boolean };
  preset(): { ref: PresetRef | 'custom' | null; mixed: boolean };
  setShade(part: ShadePart, shade: string | null): EditState;
  clearMakeup(part: ShadePart): EditState;
  applyPreset(id: PresetId, amount: number): EditState;
  setPresetAmount(amount: number): EditState;
  setFilter(filterId: string): EditState;
  setBodyProtect(on: boolean): EditState;
  setHeightBand(band: HeightBand | null): EditState;
  resetGroup(group: ParamGroup): EditState;
  groupNeutral(group: ParamGroup): boolean;
  groupHasValue(group: ParamGroup): boolean;
  reset(): EditState;
}

/** before any detection the implicit person edits everything, as v0.3 did (S §3.3 item 2) */
export const P0_INFO: readonly PersonInfo[] = [{ id: 'p0', face: true, body: true }];

type PV = keyof PersonParams['values'];
type PhV = keyof PhotoParams['values'];
const OK: RegionStatus = { ok: true, reason: null };
const no = (reason: string): RegionStatus => ({ ok: false, reason });
const clamp01 = (v: number) => (Number.isNaN(v) ? 0 : Math.min(1, Math.max(0, v)));
/** the no-face exception: these act on all skin through the primary (RM §3.3) */
const ALL_SKIN: ReadonlySet<ParamId> = new Set<ParamId>(['skin.smooth', 'skin.rosy']);
/** editing these breaks the photo's preset link (RM §3.4) */
const LINK_BREAKERS: ReadonlySet<ParamId> = new Set<ParamId>(['skin.whiten', 'skin.sharpen', 'filter.amount']);
const makeupKey = (part: ShadePart): PV => (part === 'lip' ? 'makeup.lip' : 'makeup.blush');
/** presets match by id: 程度 differences do not make 全部 "mixed" for the strip (S §2.4) */
const sameRef = (a: PresetRef | 'custom', b: PresetRef | 'custom') => (a === 'custom' ? b === 'custom' : b !== 'custom' && a.id === b.id);

export function lensFor(edit: EditState, sel: Selection, persons: readonly PersonInfo[], primary: PersonId, opts: LensOptions = {}): Lens {
  const info = new Map(persons.map((p) => [p.id, p]));
  const noFace = !persons.some((p) => p.face);
  /** primary first: "the first applicable person" under 全部 */
  const order = [primary, ...persons.map((p) => p.id).filter((id) => id !== primary)].filter((id) => info.has(id));
  const selected = sel.kind === 'person' ? (info.get(sel.id) ?? null) : null;
  const isBody = (id: ParamId) => paramDef(id).group === 'body';
  const isPhoto = (id: ParamId) => paramDef(id).scope === 'photo';
  const applicable = (p: PersonInfo, id: ParamId) => (isBody(id) ? p.body && (opts.available?.(p.id, id) ?? true) : p.face);
  /** ⊘ also resets the tab's photo items only under 全部 or with fewer than 2 persons (RM §2.1, r2) */
  const photoToo = sel.kind === 'all' || persons.length < 2;

  function targets(id: ParamId): PersonId[] {
    if (isPhoto(id)) return [];
    if (!isBody(id) && noFace) return ALL_SKIN.has(id) ? [primary] : [];
    if (sel.kind === 'person') return selected && applicable(selected, id) ? [selected.id] : [];
    return order.filter((pid) => applicable(info.get(pid)!, id));
  }
  function faceTargets(): PersonId[] {
    if (noFace) return [primary];
    if (sel.kind === 'person') return selected?.face ? [selected.id] : [];
    return order.filter((pid) => info.get(pid)!.face);
  }
  const shownOf = (t: readonly PersonId[]) => t[0] ?? (sel.kind === 'person' ? sel.id : primary);
  const person = (pid: PersonId) => personOf(edit, pid);

  const withPresetPart = (p: PersonParams, id: PresetId, amount: number): PersonParams => {
    const q = applyPreset(id, amount);
    const values = { ...p.values };
    for (const k of PRESET_PERSON_IDS) values[k] = q.values[k];
    return { values, shades: { lip: q.lipShade, blush: q.blushShade }, preset: { id, amount: q.presetAmount } };
  };
  const withPhotoPart = (ph: PhotoParams, id: PresetId, amount: number): PhotoParams => {
    const q = applyPreset(id, amount);
    const values = { ...ph.values };
    for (const k of PRESET_PHOTO_IDS) values[k] = q.values[k];
    return { ...ph, values, filterId: q.filterId, presetLink: { id, amount: q.presetAmount } };
  };

  const lens: Lens = {
    edit,
    sel,
    persons,
    primary,
    noFace,
    targets,
    faceTargets,
    get(id) {
      if (isPhoto(id)) return { value: edit.photo.values[id as PhV], mixed: false };
      const t = targets(id);
      const value = person(shownOf(t)).values[id as PV];
      const def = paramDef(id);
      const mixed = t.some((pid) => displayValue(def, person(pid).values[id as PV]) !== displayValue(def, value));
      return { value, mixed };
    },
    set(id, v) {
      const val = clamp01(v);
      if (isPhoto(id)) {
        return withPhoto(edit, (ph) => {
          const next: PhotoParams = { ...ph, values: { ...ph.values, [id]: val } };
          if (LINK_BREAKERS.has(id)) next.presetLink = null;
          if (id === 'body.legs') next.legsAnchor = selected?.body ? selected.id : null;
          return next;
        });
      }
      return withPersons(edit, targets(id), (p) => ({ ...p, values: { ...p.values, [id]: val }, preset: isBody(id) ? p.preset : 'custom' }));
    },
    applies(id) {
      if (isPhoto(id) || targets(id).length) return OK;
      if (!isBody(id) && noFace) return no(NO_FACE_PHOTO_NOTE);
      if (selected && isBody(id) && selected.body) return no('此照片無法使用這個效果');
      return no(isBody(id) ? NO_BODY_NOTE : NO_FACE_NOTE);
    },
    shade(part) {
      const key = makeupKey(part);
      const t = faceTargets();
      const p = person(shownOf(t));
      const on = p.values[key] > 0.01;
      const shade = p.shades[part];
      const mixed = t.some((pid) => {
        const q = person(pid);
        return q.values[key] > 0.01 !== on || q.shades[part] !== shade;
      });
      return { shade, on, mixed };
    },
    preset() {
      const t = faceTargets();
      if (!t.length) return { ref: null, mixed: false };
      const refs = t.map((pid) => person(pid).preset);
      return { ref: refs[0], mixed: refs.some((r) => !sameRef(refs[0], r)) };
    },
    setShade(part, shade) {
      const key = makeupKey(part);
      return withPersons(edit, faceTargets(), (p) => ({
        ...p,
        shades: { ...p.shades, [part]: shade },
        values: { ...p.values, [key]: p.values[key] > 0.01 ? p.values[key] : MAKEUP_PICK_DEFAULT[part] },
        preset: 'custom',
      }));
    },
    clearMakeup(part) {
      const key = makeupKey(part);
      return withPersons(edit, faceTargets(), (p) => ({ ...p, shades: { ...p.shades, [part]: null }, values: { ...p.values, [key]: 0 }, preset: 'custom' }));
    },
    applyPreset(id, amount) {
      const a = clamp01(amount);
      return withPhoto(
        withPersons(edit, faceTargets(), (p) => withPresetPart(p, id, a)),
        (ph) => withPhotoPart(ph, id, a),
      );
    },
    setPresetAmount(amount) {
      const { ref, mixed } = lens.preset();
      const a = clamp01(amount);
      const link = edit.photo.presetLink;
      // a body-only person: 程度 scales only the photo part (S §2.4 一鍵)
      if (ref === null) return link ? withPhoto(edit, (ph) => withPhotoPart(ph, link.id, a)) : edit;
      if (ref === 'custom' || mixed) return edit;
      const e = withPersons(edit, faceTargets(), (p) => withPresetPart(p, ref.id, a));
      return link?.id === ref.id ? withPhoto(e, (ph) => withPhotoPart(ph, ref.id, a)) : e;
    },
    setFilter(filterId) {
      const f = FILTERS.find((x) => x.id === filterId) ?? FILTERS[0];
      return withPhoto(edit, (ph) => ({
        ...ph,
        filterId: f.id,
        values: { ...ph.values, 'filter.amount': f.id === 'none' ? ph.values['filter.amount'] : f.defaultAmount },
        presetLink: null,
      }));
    },
    setBodyProtect(on) {
      return withPhoto(edit, (ph) => (ph.bodyProtect === on ? ph : { ...ph, bodyProtect: on }));
    },
    setHeightBand(band) {
      return withPhoto(edit, (ph) => ({ ...ph, heightBand: band ? cleanBand(band) : null }));
    },
    resetGroup(group) {
      const defs = paramsInGroup(group);
      const personIds = defs.filter((d) => d.scope === 'person').map((d) => d.id);
      const who = [...new Set(personIds.flatMap((id) => targets(id)))];
      let e = withPersons(edit, who, (p) => {
        const values = { ...p.values };
        for (const id of personIds) values[id as PV] = neutralValue(paramDef(id));
        return { ...p, values, preset: group === 'body' ? p.preset : 'custom' };
      });
      if (group === 'makeup') e = withPersons(e, faceTargets(), (p) => ({ ...p, shades: { lip: null, blush: null } }));
      const photoIds = defs.filter((d) => d.scope === 'photo').map((d) => d.id);
      if ((photoToo || group === 'filter') && (photoIds.length || group === 'body')) {
        e = withPhoto(e, (ph) => {
          const values = { ...ph.values };
          for (const id of photoIds) values[id as PhV] = neutralValue(paramDef(id));
          const next: PhotoParams = { ...ph, values };
          if (photoIds.some((id) => LINK_BREAKERS.has(id))) next.presetLink = null;
          if (group === 'filter') next.filterId = 'none';
          if (group === 'body') {
            next.heightBand = null;
            next.legsAnchor = null;
          }
          return next;
        });
      }
      return e;
    },
    groupNeutral(group) {
      for (const d of paramsInGroup(group)) {
        if (d.scope === 'photo') {
          if (photoToo && hasValue(d, edit.photo.values[d.id as PhV])) return false;
        } else if (targets(d.id).some((pid) => hasValue(d, person(pid).values[d.id as PV]))) return false;
      }
      return !(group === 'body' && photoToo && edit.photo.heightBand !== null);
    },
    groupHasValue(group) {
      return paramsInGroup(group).some((d) => {
        if (d.scope === 'photo') return hasValue(d, edit.photo.values[d.id as PhV]);
        const t = targets(d.id);
        return (t.length ? t : [shownOf(t)]).some((pid) => hasValue(d, person(pid).values[d.id as PV]));
      });
    },
    reset() {
      return resetAll(edit);
    },
  };
  return lens;
}
```

- [x] **Step 4: Run the tests**

Run: `npx vitest run src/edit`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/edit/lens.ts src/edit/lens.test.ts
git commit -m "v0.4 step 1b: the lens (photo/person routing, 全部, presets, ⊘, 重置)"
```

---

### Task 7: `UndoStack {clone: false, key}` and `rebase`

**Files:**
- Modify: `src/store/undo.ts:1-62`, `src/store/undo.test.ts` (append), `src/ui/deps.ts:13,29-38,64` (CRLF), `tests/harness/t7/fakes.ts:321-351`

**Interfaces:**
- Consumes: nothing new.
- Produces: `interface UndoOptions<T> { clone?: boolean; key?: (s: T) => string }`; `new UndoStack<T>(limit = 50, opts: UndoOptions<T> = {})`; `UndoStack.rebase(fn: (s: T) => T): void`; `UndoLike<T>.rebase(fn: (s: T) => T): void`; `deps.createUndo: <T>(limit?: number, opts?: UndoOptions<T>) => UndoLike<T>`.

- [x] **Step 1: Write the failing tests** (append to `src/store/undo.test.ts`)

```ts
describe('UndoStack {clone: false, key} and rebase (RM §3.4)', () => {
  it('stores and returns states by reference and compares by the given key', () => {
    const key = (s: { id: number; big: Float32Array }) => String(s.id);
    const u = new UndoStack<{ id: number; big: Float32Array }>(50, { clone: false, key });
    const a = { id: 1, big: new Float32Array(4) };
    const b = { id: 2, big: a.big };
    u.reset(a);
    u.push(b);
    u.push({ id: 2, big: new Float32Array(9) }); // same key: ignored
    expect(u.current).toBe(b);
    expect(u.undo()).toBe(a);
    expect(u.redo()).toBe(b);
  });
  it('rebase maps every stored state, so undo never brings back a state without the new persons', () => {
    const u = new UndoStack<{ persons: string[] }>(50, { clone: false });
    u.reset({ persons: ['p0'] });
    u.push({ persons: ['p0', 'x'] });
    u.rebase((s) => ({ persons: s.persons.map((p) => (p === 'p0' ? 'f0' : p)).concat('f1') }));
    expect(u.current).toEqual({ persons: ['f0', 'x', 'f1'] });
    expect(u.undo()).toEqual({ persons: ['f0', 'f1'] });
    expect(u.canRedo).toBe(true);
  });
  it('the default (cloning, stableKey) is unchanged', () => {
    const u = new UndoStack<{ a: number }>();
    const s = { a: 1 };
    u.reset(s);
    expect(u.current).not.toBe(s);
    expect(u.current).toEqual(s);
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `npx vitest run src/store/undo.test.ts`
Expected: FAIL (`rebase is not a function`; the by-reference test sees clones).

- [x] **Step 3: Implement** — replace `src/store/undo.ts:1-62` (keep `stableKey` below it unchanged) with:

```ts
// OWNER: store agent. Generic bounded undo/redo stack.
//
// `limit` is the number of undo steps kept (so at most limit + 1 states). By default states are stored and handed out
// as structuredClones, so callers can't mutate history by holding on to a reference. `{clone: false}` keeps states by
// reference, which is safe for immutable values (EditState, RM §3.4) and shares their unchanged parts; `key` replaces
// stableKey as the equality test (the editor passes editKey).
export interface UndoOptions<T> {
  clone?: boolean;
  key?: (s: T) => string;
}

export class UndoStack<T> {
  private readonly limit: number;
  private readonly clone: boolean;
  private readonly keyOf: (s: T) => string;
  private states: T[] = [];
  /** key of each state, parallel to `states` (equality test without re-serialising history) */
  private keys: string[] = [];
  private index = -1;

  constructor(limit = 50, opts: UndoOptions<T> = {}) {
    this.limit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 50;
    this.clone = opts.clone ?? true;
    this.keyOf = opts.key ?? stableKey;
  }

  private copy(s: T): T {
    return this.clone ? structuredClone(s) : s;
  }

  /** clear history and set the current state */
  reset(initial: T): void {
    this.states = [this.copy(initial)];
    this.keys = [this.keyOf(initial)];
    this.index = 0;
  }

  /** record a new current state (drops the redo branch); ignores pushes equal (key) to current */
  push(state: T): void {
    const key = this.keyOf(state);
    if (this.index >= 0 && key === this.keys[this.index]) return;
    this.states.length = this.index + 1;
    this.keys.length = this.index + 1;
    this.states.push(this.copy(state));
    this.keys.push(key);
    const excess = this.states.length - 1 - this.limit;
    if (excess > 0) {
      this.states.splice(0, excess);
      this.keys.splice(0, excess);
    }
    this.index = this.states.length - 1;
  }

  /** map every stored state (a detection added persons, p0 handed over, a v1 entry migrated): RM §3.4 */
  rebase(fn: (s: T) => T): void {
    this.states = this.states.map((s) => this.copy(fn(s)));
    this.keys = this.states.map((s) => this.keyOf(s));
  }

  undo(): T | null {
    if (this.index <= 0) return null;
    this.index--;
    return this.copy(this.states[this.index]);
  }

  redo(): T | null {
    if (this.index < 0 || this.index >= this.states.length - 1) return null;
    this.index++;
    return this.copy(this.states[this.index]);
  }

  get current(): T | null {
    return this.index >= 0 ? this.copy(this.states[this.index]) : null;
  }

  get canUndo(): boolean {
    return this.index > 0;
  }

  get canRedo(): boolean {
    return this.index >= 0 && this.index < this.states.length - 1;
  }
}
```

`src/ui/deps.ts` (CRLF): change the import to `import { UndoStack, type UndoOptions } from '../store/undo';`; add `rebase(fn: (s: T) => T): void;` to `UndoLike<T>` (after `redo()`); replace the `createUndo` line with `createUndo: <T>(limit?: number, opts?: UndoOptions<T>): UndoLike<T> => new UndoStack<T>(limit, opts),`.

`tests/harness/t7/fakes.ts`, class `FakeUndo` (`:321`), add after `redo()`:

```ts
  rebase(fn: (s: T) => T) {
    this.stack = this.stack.map((s) => structuredClone(fn(s)));
  }
```

- [x] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/store && npm run typecheck`
Expected: PASS; `tsc` exits 0.

- [x] **Step 5: Commit**

```bash
git add src/store/undo.ts src/store/undo.test.ts src/ui/deps.ts tests/harness/t7/fakes.ts
git commit -m "v0.4 step 1b: UndoStack {clone: false, key} and rebase"
```

---

### Task 8: HistoryEntry v2 storage and `normalizeDetect`

**Files:**
- Create: `src/detect/cache.ts`, `src/detect/cache.test.ts`, `src/detect/testCaches.ts`
- Modify: `src/types.ts:379-405` (HistoryEntry, CRLF), `src/store/history.ts:8-9,27-97,160-208`, `src/store/history.test.ts` (append)

**Interfaces:**
- Consumes: Tasks 4–5 (`isEditStateRecord`, `sanitizeEditState`, `P0_INFO`/`PersonInfo` from Task 6); limits (`MAX_RENDER_FACES`, `MAX_OBSTACLES`, `MAX_EDIT_BODIES`).
- Produces:
  - `HistoryEntry` gains `schema?: 2; edit?: EditState; paramsKey?: string; detect?: DetectionCache;` and two read-side-only fields (never written by `addEntry`/`updateEntry`): `staleBoxes?: Record<PersonId, Rect>` (face boxes of a dropped cache's persons) and `detectLost?: boolean` (normalization dropped persons).
  - `updateEntry(id, patch, opts?: { touch?: boolean })`; `patch` may carry `schema`, `edit`, `paramsKey`, `detect`. Without `touch` an `edit`, `params` or `thumb` bumps `updatedAt` (today's rule extended); `touch: false` never bumps (A17).
  - `src/detect/cache.ts`: `normalizeMask(raw: unknown): PersonMask | null` (moved from `history.ts:200-208`); `normalizeDetect(raw: unknown): { cache: DetectionCache | null; stale: Record<PersonId, Rect> | null; lost: boolean }`; `cachedFits(cache: DetectionCache, width: number, height: number): boolean`; `personInfos(cache: DetectionCache | null): PersonInfo[]`; `noFaceCache(width: number, height: number, faceScans: DetectionCache['faceScans']): DetectionCache`; `boxScore(b: Rect): number`; `poseBox(points: Float32Array): Rect`; `scanned0(cache: DetectionCache): boolean`.
  - `src/detect/testCaches.ts` (test-only): `cacheFace(id: string, cx: number, w?: number): CachedFace`, `cacheBody(id: string, cx: number): CachedBody`, `makeCache(over?: Partial<DetectionCache>): DetectionCache`.

- [x] **Step 1: Write the test helpers `src/detect/testCaches.ts`**

```ts
// Test doubles for detection caches (never imported by app code).
import type { CachedBody, CachedFace, DetectionCache } from '../types';

/** a face whose 478 points lie on a circle (radius w/2) around (cx, 0.5); box = its bbox */
export function cacheFace(id: string, cx: number, w = 0.2): CachedFace {
  const lm = new Float32Array(478 * 3);
  for (let i = 0; i < 478; i++) {
    const a = (i / 478) * Math.PI * 2;
    lm[i * 3] = cx + (w / 2) * Math.cos(a);
    lm[i * 3 + 1] = 0.5 + (w / 2) * Math.sin(a);
  }
  return { id, lm, box: { x: cx - w / 2, y: 0.5 - w / 2, w, h: w } };
}

/** a standing pose centred at cx (all visible), no mask */
export function cacheBody(id: string, cx: number): CachedBody {
  const points = new Float32Array(33 * 4);
  for (let i = 0; i < 33; i++) {
    points[i * 4] = cx + (i % 2 ? 0.05 : -0.05);
    points[i * 4 + 1] = 0.1 + (0.8 * i) / 32;
    points[i * 4 + 3] = 0.99;
  }
  return { id, pose: { points }, mask: null, score: 0.1 };
}

/** two faces (f0 left, f1 right), no bodies yet, scanned upright */
export function makeCache(over: Partial<DetectionCache> = {}): DetectionCache {
  return {
    v: 1,
    width: 1600,
    height: 1200,
    faceScans: [{ quarter: 0, flipH: false }],
    faces: [cacheFace('f0', 0.3), cacheFace('f1', 0.7)],
    obstacles: [],
    bodies: null,
    bodiesComplete: true,
    persons: [
      { id: 'f0', face: 'f0', body: null },
      { id: 'f1', face: 'f1', body: null },
    ],
    primary: 'f0',
    dropped: { tooSmall: 0, overCap: 0 },
    ...over,
  };
}
```

- [x] **Step 2: Write the failing tests**

```ts
// src/detect/cache.test.ts
import { describe, expect, it } from 'vitest';
import { boxScore, cachedFits, noFaceCache, normalizeDetect, personInfos, poseBox } from './cache';
import { cacheBody, cacheFace, makeCache } from './testCaches';

describe('normalizeDetect (S §5.4)', () => {
  it('keeps a valid cache as it is', () => {
    const c = makeCache({ bodies: [cacheBody('b0', 0.3)], persons: [{ id: 'f0', face: 'f0', body: 'b0' }, { id: 'f1', face: 'f1', body: null }] });
    const r = normalizeDetect(structuredClone(c));
    expect(r.cache).toEqual(c);
    expect(r).toMatchObject({ stale: null, lost: false });
  });
  it('a corrupt face drops only that face, its link and a person left with nothing (lost)', () => {
    const c = makeCache();
    const raw = structuredClone(c) as unknown as { faces: { lm: Float32Array }[] };
    raw.faces[1].lm = new Float32Array(10);
    const r = normalizeDetect(raw);
    expect(r.cache?.faces.map((f) => f.id)).toEqual(['f0']);
    expect(r.cache?.persons.map((p) => p.id)).toEqual(['f0']);
    expect(r.lost).toBe(true);
  });
  it('person links to missing faces are removed (Review Focus #5)', () => {
    const c = makeCache({ persons: [{ id: 'f0', face: 'f0', body: null }, { id: 'f1', face: 'f9', body: null }] });
    const r = normalizeDetect(c);
    expect(r.cache?.persons).toEqual([{ id: 'f0', face: 'f0', body: null }]);
    expect(r.lost).toBe(true);
  });
  it('the no-face cache with p0 is valid; p0 elsewhere is not', () => {
    const none = noFaceCache(1000, 800, [{ quarter: 0, flipH: false }]);
    expect(normalizeDetect(none).cache).toEqual(none);
    const bad = makeCache({ persons: [{ id: 'p0', face: null, body: null }, { id: 'f0', face: 'f0', body: null }, { id: 'f1', face: 'f1', body: null }] });
    expect(normalizeDetect(bad).cache?.persons.map((p) => p.id)).toEqual(['f0', 'f1']);
  });
  it('a cache with more faces than this tier allows is not truncated, but obstacles beyond MAX_OBSTACLES are', () => {
    const faces = [0.1, 0.25, 0.4, 0.55, 0.7, 0.85].map((x, i) => cacheFace(`f${i}`, x, 0.1));
    const persons = faces.map((f) => ({ id: f.id, face: f.id, body: null }));
    const obstacles = Array.from({ length: 10 }, () => ({ box: { x: 0.1, y: 0.1, w: 0.01, h: 0.01 }, oval: new Float32Array(72).fill(0.1) }));
    const r = normalizeDetect(makeCache({ faces, persons, obstacles }));
    expect(r.cache?.faces).toHaveLength(6);
    expect(r.cache?.obstacles).toHaveLength(8);
  });
  it('an unusable cache is dropped with the readable face boxes of its persons', () => {
    const c = makeCache();
    const r = normalizeDetect({ ...c, v: 7 });
    expect(r.cache).toBeNull();
    expect(r.stale).toEqual({ f0: c.faces[0].box, f1: c.faces[1].box });
    expect(normalizeDetect(undefined)).toEqual({ cache: null, stale: null, lost: false });
  });
  it('a cache whose faces or bodies were all corrupt is dropped, not read as "nobody here" (p0 only in the stored no-face form)', () => {
    const c = makeCache();
    const both = structuredClone(c) as unknown as { faces: { lm: Float32Array }[] };
    both.faces[0].lm = new Float32Array(10);
    both.faces[1].lm = new Float32Array(10);
    expect(normalizeDetect(both)).toEqual({ cache: null, stale: { f0: c.faces[0].box, f1: c.faces[1].box }, lost: true });
    const one = makeCache({ faces: [cacheFace('f0', 0.5)], persons: [{ id: 'f0', face: 'f0', body: null }] });
    const oneRaw = structuredClone(one) as unknown as { faces: { lm: Float32Array }[] };
    oneRaw.faces[0].lm = new Float32Array(10);
    expect(normalizeDetect(oneRaw)).toEqual({ cache: null, stale: { f0: one.faces[0].box }, lost: true });
    const badBody = { ...cacheBody('b0', 0.5), pose: { points: new Float32Array(10) } };
    const bodyOnly = makeCache({ faces: [], bodies: [badBody], persons: [{ id: 'b0', face: null, body: 'b0' }], primary: 'b0' });
    expect(normalizeDetect(bodyOnly)).toEqual({ cache: null, stale: {}, lost: true });
    const noFaces = { ...noFaceCache(1000, 800, [{ quarter: 0, flipH: false }]), faces: undefined };
    expect(normalizeDetect(noFaces).cache).toBeNull();
    const bodiesEmpty = { ...noFaceCache(1000, 800, [{ quarter: 0, flipH: false }]), bodies: [] };
    expect(normalizeDetect(bodiesEmpty)).toEqual({ cache: bodiesEmpty, stale: null, lost: false });
  });
});

describe('cache helpers', () => {
  it('cachedFits checks the aspect within 1 %', () => {
    const c = makeCache();
    expect(cachedFits(c, 2048, 1536)).toBe(true);
    expect(cachedFits(c, 1440, 1080)).toBe(true);
    expect(cachedFits(c, 1536, 2048)).toBe(false);
  });
  it('personInfos: cache links, or the implicit person before any cache', () => {
    expect(personInfos(makeCache({ bodies: [cacheBody('b0', 0.3)], persons: [{ id: 'f0', face: 'f0', body: 'b0' }] }))).toEqual([{ id: 'f0', face: true, body: true }]);
    expect(personInfos(null)).toEqual([{ id: 'p0', face: true, body: true }]);
    expect(personInfos(noFaceCache(10, 10, []))).toEqual([{ id: 'p0', face: false, body: false }]);
  });
  it('boxScore is selectPerson’s area × centrality; poseBox clips to the frame', () => {
    expect(boxScore({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 })).toBeCloseTo(0.25);
    expect(boxScore({ x: 0, y: 0, w: 0.5, h: 0.5 })).toBeLessThan(boxScore({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }));
    const b = poseBox(cacheBody('b0', 0.98).pose.points);
    expect(b.x + b.w).toBeLessThanOrEqual(1);
  });
});
```

Append to `src/store/history.test.ts` (add `import { editFromLegacy } from '../edit/legacy';` and `import { makeCache } from '../detect/testCaches';`):

```ts
describe('HistoryEntry v2 (RM §5.1, S §5.2)', () => {
  const v2 = () => {
    const edit = editFromLegacy(applyPreset('refined', 1));
    return { schema: 2 as const, edit, paramsKey: 'k', detect: makeCache() };
  };
  it('round-trips schema, edit, paramsKey and the detection cache with its typed arrays', async () => {
    const id = await addEntry({ ...entry('v2'), ...v2() });
    const got = await getEntry(id);
    expect(got?.schema).toBe(2);
    expect(got?.edit).toEqual(v2().edit);
    expect(got?.paramsKey).toBe('k');
    expect(got?.detect?.faces[0].lm).toBeInstanceOf(Float32Array);
    expect(got?.detect).toEqual(makeCache());
  });
  it('an edit bumps updatedAt like params; touch: false never does, even with an edit and a thumbnail', async () => {
    const id = await addEntry(entry('t'));
    const t0 = (await getEntry(id))!.updatedAt;
    await updateEntry(id, { detect: makeCache(), edit: v2().edit, thumb: new Blob(['t']) }, { touch: false });
    expect((await getEntry(id))!.updatedAt).toBe(t0);
    expect((await getEntry(id))!.detect).toEqual(makeCache());
    await updateEntry(id, { edit: v2().edit });
    expect((await getEntry(id))!.updatedAt).toBeGreaterThan(t0);
  });
  it('a corrupt edit is dropped (the entry opens as v1), a dropped cache leaves its stale boxes', async () => {
    const e = normalizeEntry({ ...validRecord('x', 1), schema: 2, edit: { v: 9 }, detect: { ...makeCache(), v: 3 } });
    expect(e?.edit).toBeUndefined();
    expect(e?.detect).toBeUndefined();
    expect(Object.keys(e?.staleBoxes ?? {})).toEqual(['f0', 'f1']);
  });
});
```

(`entry(tag)` and `validRecord(id, updatedAt)` are the file's existing builders, `history.test.ts:44, 79`.)

- [x] **Step 3: Run to verify failure**

Run: `npx vitest run src/detect src/store/history.test.ts`
Expected: FAIL (cannot resolve `./cache`; `getEntry(id).schema` undefined).

- [x] **Step 4: Write `src/detect/cache.ts` (normalization and helpers)**

```ts
// The detection cache of one photo (RM §3.6, S §3.2, §5.4): faces, obstacles, bodies and the persons built from them,
// all in normalized O-space, stored in HistoryEntry.detect so a reopen runs no detector. This file validates a stored
// cache and answers questions about it; building and merging land in Task 15.
import { MAX_EDIT_BODIES, MAX_OBSTACLES, MAX_RENDER_FACES } from '../config/limits';
import { P0_INFO, type PersonInfo } from '../edit/lens';
import type { CachedBody, CachedFace, CachedObstacle, DetectionCache, PersonId, PersonInfoCached, PersonMask, Rect } from '../types';

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const FACE_ID = /^f[0-5]$/;
const BODY_ID = /^b[0-3]$/;
const PERSON_ID = /^(f[0-5]|b[0-3]|p0)$/;

/** Untrusted mask → valid PersonMask (w·h bytes), else null (was history.ts normalizeMask). */
export function normalizeMask(raw: unknown): PersonMask | null {
  if (!isRecord(raw)) return null;
  const { width, height, data } = raw;
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
  const w = width as number;
  const h = height as number;
  if (w <= 0 || h <= 0 || !(data instanceof Uint8Array) || data.length !== w * h) return null;
  return { width: w, height: h, data };
}

function normBox(raw: unknown): Rect | null {
  if (!isRecord(raw)) return null;
  const { x, y, w, h } = raw;
  if (!finite(x) || !finite(y) || !finite(w) || !finite(h) || w <= 0 || h <= 0) return null;
  if (x < -0.1 || y < -0.1 || x + w > 1.1 || y + h > 1.1) return null;
  return { x, y, w, h };
}

function normFace(raw: unknown): CachedFace | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !FACE_ID.test(raw.id)) return null;
  const lm = raw.lm;
  if (!(lm instanceof Float32Array) || lm.length !== 478 * 3 || !lm.every(Number.isFinite)) return null;
  const box = normBox(raw.box);
  return box ? { id: raw.id, lm, box } : null;
}

function normObstacle(raw: unknown): CachedObstacle | null {
  if (!isRecord(raw)) return null;
  const oval = raw.oval;
  if (!(oval instanceof Float32Array) || oval.length !== 72 || !oval.every(Number.isFinite)) return null;
  const box = normBox(raw.box);
  return box ? { box, oval } : null;
}

function normBody(raw: unknown): CachedBody | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !BODY_ID.test(raw.id) || !finite(raw.score)) return null;
  const pose = raw.pose;
  const points = isRecord(pose) ? pose.points : null;
  if (!(points instanceof Float32Array) || points.length !== 33 * 4 || !points.every(Number.isFinite)) return null;
  let mask: PersonMask | null = null;
  if (raw.mask !== null) {
    mask = normalizeMask(raw.mask);
    if (!mask) return null;
  }
  return { id: raw.id, pose: { points }, mask, score: raw.score };
}

/** face boxes of the raw record's persons that are still readable (the rematch input of a dropped cache) */
function staleBoxesOf(r: Record<string, unknown>): Record<PersonId, Rect> | null {
  const boxes = new Map<string, Rect>();
  for (const f of arr(r.faces)) {
    if (isRecord(f) && typeof f.id === 'string') {
      const b = normBox(f.box);
      if (b) boxes.set(f.id, b);
    }
  }
  const out: Record<PersonId, Rect> = {};
  for (const p of arr(r.persons)) {
    if (!isRecord(p) || typeof p.id !== 'string' || typeof p.face !== 'string') continue;
    const b = boxes.get(p.face);
    if (b) out[p.id] = b;
  }
  return out;
}

/**
 * Untrusted stored cache → a valid one (S §5.4). A corrupt face, obstacle or body drops only that part and its link;
 * a person left with neither face nor body is dropped and `lost` is set (the cache-dropped toast). A cache that cannot
 * be used at all returns null with `stale`: the face boxes of its persons, for rematchByIoU. Caches are never
 * truncated to this device's tier caps (A16), only to the hard bounds MAX_RENDER_FACES / MAX_EDIT_BODIES / MAX_OBSTACLES.
 */
export function normalizeDetect(raw: unknown): { cache: DetectionCache | null; stale: Record<PersonId, Rect> | null; lost: boolean } {
  if (raw === undefined || raw === null) return { cache: null, stale: null, lost: false };
  if (!isRecord(raw)) return { cache: null, stale: {}, lost: true };
  const fail = () => ({ cache: null, stale: staleBoxesOf(raw), lost: true });
  if (raw.v !== 1 || !finite(raw.width) || !finite(raw.height) || raw.width <= 0 || raw.height <= 0) return fail();
  let lost = false;
  const faces: CachedFace[] = [];
  for (const f of arr(raw.faces)) {
    const c = normFace(f);
    if (c && !faces.some((x) => x.id === c.id) && faces.length < MAX_RENDER_FACES) faces.push(c);
    else lost = true;
  }
  const obstacles = arr(raw.obstacles)
    .map(normObstacle)
    .filter((o): o is CachedObstacle => o !== null)
    .slice(0, MAX_OBSTACLES);
  let bodies: CachedBody[] | null = null;
  if (raw.bodies !== null) {
    bodies = [];
    for (const b of arr(raw.bodies)) {
      const c = normBody(b);
      if (c && !bodies.some((x) => x.id === c.id) && bodies.length < MAX_EDIT_BODIES) bodies.push(c);
      else lost = true;
    }
  }
  const faceScans = arr(raw.faceScans)
    .filter((s): s is { quarter: 0 | 1 | 2 | 3; flipH: boolean } => isRecord(s) && [0, 1, 2, 3].includes(s.quarter as number) && typeof s.flipH === 'boolean')
    .map((s) => ({ quarter: s.quarter, flipH: s.flipH }));
  const dropped = isRecord(raw.dropped) ? raw.dropped : {};
  const count = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : 0);
  const base = {
    v: 1 as const,
    width: raw.width,
    height: raw.height,
    faceScans,
    faces,
    obstacles,
    bodies,
    bodiesComplete: typeof raw.bodiesComplete === 'boolean' ? raw.bodiesComplete : true,
    dropped: { tooSmall: count(dropped.tooSmall), overCap: count(dropped.overCap) },
  };
  if (!faces.length && !bodies?.length) {
    // p0 only in the stored no-face form (faces = [], bodies null or []). A record whose faces or bodies were all
    // dropped as corrupt is not "nobody here": it is dropped, so the photo re-detects and rematches by its stale boxes.
    const storedEmpty = Array.isArray(raw.faces) && !raw.faces.length && (raw.bodies === null || (Array.isArray(raw.bodies) && !raw.bodies.length));
    if (!storedEmpty) return fail();
    return { cache: { ...base, persons: [{ id: 'p0', face: null, body: null }], primary: 'p0' }, stale: null, lost };
  }
  const persons: PersonInfoCached[] = [];
  const usedFaces = new Set<string>();
  const usedBodies = new Set<string>();
  for (const p of arr(raw.persons)) {
    if (!isRecord(p) || typeof p.id !== 'string' || !PERSON_ID.test(p.id) || p.id === 'p0' || persons.some((x) => x.id === p.id)) {
      lost = true;
      continue;
    }
    const face = typeof p.face === 'string' && faces.some((f) => f.id === p.face) && !usedFaces.has(p.face) ? p.face : null;
    const body = typeof p.body === 'string' && bodies?.some((b) => b.id === p.body) && !usedBodies.has(p.body) ? p.body : null;
    if ((p.face !== null && face === null) || (p.body !== null && body === null)) lost = true;
    if (!face && !body) continue;
    if (face) usedFaces.add(face);
    if (body) usedBodies.add(body);
    persons.push({ id: p.id, face, body });
  }
  if (!persons.length) return fail();
  const primary = typeof raw.primary === 'string' && persons.some((p) => p.id === raw.primary) ? raw.primary : persons[0].id;
  if (primary !== raw.primary) lost = true;
  return { cache: { ...base, persons, primary }, stale: null, lost };
}

/** the cache was taken at this photo's aspect (normalized coordinates fit any decode size; RM §5.2) */
export function cachedFits(cache: DetectionCache, width: number, height: number): boolean {
  if (!(width > 0 && height > 0)) return false;
  return Math.abs(cache.width / cache.height / (width / height) - 1) < 0.01;
}

/** a definite upright face answer exists (faceScans holds {0, false}; [] = 基本模式) */
export function scanned0(cache: DetectionCache): boolean {
  return cache.faceScans.some((s) => s.quarter === 0 && !s.flipH);
}

/** what the lens needs per person; before any cache the implicit person edits everything */
export function personInfos(cache: DetectionCache | null): PersonInfo[] {
  if (!cache) return [...P0_INFO];
  return cache.persons.map((p) => ({ id: p.id, face: p.face !== null, body: p.body !== null }));
}

/** a definite "nobody here": exactly one person, p0 (S §5.4) */
export function noFaceCache(width: number, height: number, faceScans: DetectionCache['faceScans']): DetectionCache {
  return {
    v: 1,
    width,
    height,
    faceScans,
    faces: [],
    obstacles: [],
    bodies: null,
    bodiesComplete: true,
    persons: [{ id: 'p0', face: null, body: null }],
    primary: 'p0',
    dropped: { tooSmall: 0, overCap: 0 },
  };
}

/** selectPerson's score (bodyTracker.ts:158-183): area × (1 − 0.5·distance of the centre from the image centre / √½) */
export function boxScore(b: Rect): number {
  const d = Math.hypot(b.x + b.w / 2 - 0.5, b.y + b.h / 2 - 0.5) / Math.SQRT1_2;
  return Math.max(0, b.w) * Math.max(0, b.h) * (1 - 0.5 * d);
}

/** bbox of a pose's points clipped to the frame (as selectPerson measures it) */
export function poseBox(points: Float32Array): Rect {
  let x0 = 1;
  let y0 = 1;
  let x1 = 0;
  let y1 = 0;
  for (let i = 0; i < points.length / 4; i++) {
    const x = Math.min(1, Math.max(0, points[i * 4]));
    const y = Math.min(1, Math.max(0, points[i * 4 + 1]));
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}
```

- [x] **Step 5: HistoryEntry v2 fields**

`src/types.ts` (CRLF), `HistoryEntry` (`:379-405`), after `faceMask?: PersonMask;` add:

```ts
  /** 2 for entries written by 0.4; absent = v1 (RM §5.1) */
  schema?: 2;
  /** v2 edit (RM §3.2) */
  edit?: EditState;
  /** v2: stableKey(params) as written by 0.4; a mismatch means 0.3 edited `params` after a rollback (S §5.3) */
  paramsKey?: string;
  /** v2 detection cache; written as soon as detection runs (no updatedAt bump) */
  detect?: DetectionCache;
  /** read side only (normalizeEntry), never written: face boxes of a dropped cache's persons, for the rematch */
  staleBoxes?: Record<PersonId, Rect>;
  /** read side only: normalization dropped persons from the cache (the cache-dropped toast) */
  detectLost?: boolean;
```

and change the `params` doc comment to `/** v2: the legacy projection (photo + primary person); v1: the only params */`.

- [x] **Step 6: Write and read the new fields in `src/store/history.ts`**

1. Imports (`:8-9`): `import { normalizeDetect, normalizeMask } from '../detect/cache';`, `import { isEditStateRecord, sanitizeEditState } from '../edit/state';`; keep `sanitizeParams`; delete the local `normalizeMask` (`:200-208`).
2. `addEntry`, after `if (e.faceMask) entry.faceMask = e.faceMask;` (`:44`):

```ts
    if (e.schema === 2) entry.schema = 2;
    if (e.edit) entry.edit = e.edit;
    if (e.paramsKey !== undefined) entry.paramsKey = e.paramsKey;
    if (e.detect) entry.detect = e.detect;
```

3. Replace `updateEntry` (`:69-97`) with:

```ts
/**
 * Patches an entry. Without `touch` an edit (params, edit or thumb) bumps updatedAt, moving the entry to the front; a
 * cache-only patch (body, detect, faceProtect / faceMask alone) keeps it. `touch: false` never bumps (A17): a
 * detection-driven rebase writes edit + params + thumb, and merely viewing an entry must not reorder 最近編輯.
 * Missing id → no-op. faceProtect false removes the flag.
 */
export function updateEntry(
  id: string,
  patch: Partial<Pick<HistoryEntry, 'params' | 'thumb' | 'body' | 'faceProtect' | 'faceMask' | 'schema' | 'edit' | 'paramsKey' | 'detect'>>,
  opts: { touch?: boolean } = {},
): Promise<void> {
  return withStore('readwrite', undefined, (store) => {
    const req = store.get(id);
    req.onsuccess = () => {
      const cur: unknown = req.result;
      if (!cur || typeof cur !== 'object') return;
      const edit = patch.params !== undefined || patch.thumb !== undefined || patch.edit !== undefined;
      const next = { ...(cur as HistoryEntry) };
      if (edit && opts.touch !== false) next.updatedAt = stamp();
      if (patch.params !== undefined) next.params = patch.params;
      if (patch.thumb !== undefined) next.thumb = patch.thumb;
      if (patch.body !== undefined) next.body = patch.body;
      if (patch.faceProtect === true) next.faceProtect = true;
      else if (patch.faceProtect === false) delete next.faceProtect;
      if (patch.faceMask) next.faceMask = patch.faceMask;
      if (patch.schema === 2) next.schema = 2;
      if (patch.edit !== undefined) next.edit = patch.edit;
      if (patch.paramsKey !== undefined) next.paramsKey = patch.paramsKey;
      if (patch.detect !== undefined) next.detect = patch.detect;
      store.put(next);
    };
    return () => undefined;
  });
}
```

4. `normalizeEntry`, before `return entry;` (`:179`):

```ts
  if (r.schema === 2) entry.schema = 2;
  // persons unfiltered here: openState filters them against the cache (or keeps them all for a rematch)
  if (isEditStateRecord(r.edit)) entry.edit = sanitizeEditState(r.edit, null);
  if (typeof r.paramsKey === 'string') entry.paramsKey = r.paramsKey;
  const d = normalizeDetect(r.detect);
  if (d.cache) entry.detect = d.cache;
  if (d.stale) entry.staleBoxes = d.stale;
  if (d.lost) entry.detectLost = true;
```

- [x] **Step 7: Run tests and typecheck**

Run: `npx vitest run src/detect src/store && npm run typecheck`
Expected: PASS (the existing v1 history tests are unchanged); `tsc` exits 0.

- [x] **Step 8: Commit**

```bash
git add src/detect/cache.ts src/detect/cache.test.ts src/detect/testCaches.ts src/types.ts src/store/history.ts src/store/history.test.ts
git commit -m "v0.4 step 1b: HistoryEntry v2 fields, updateEntry touch:false, normalizeDetect"
```

---

### Task 9: Lazy migration `openState`, `importEdit`, `cameraShotEdit`

**Files:**
- Create: `src/edit/migrate.ts`, `src/edit/migrate.test.ts`

**Interfaces:**
- Consumes: `editFromLegacy`, `splitLegacy` (Task 4), `assignPersons`, `sanitizeEditState`, `neutralPerson` (Tasks 4–5), `cachedFits`, `scanned0`, `boxScore`, `poseBox` (Task 8), `stableKey` (`undo.ts`).
- Produces:

```ts
export interface V1Bodies { bodies: CachedBody[]; complete: boolean }
export interface OpenedState {
  edit: EditState;
  /** a cache that fits this photo (used as is), or null */
  detect: DetectionCache | null;
  /** one face detection is wanted (a tracker permitting): no cache, a 基本模式 cache, or a dropped one */
  needsFaceDetect: boolean;
  /** a dropped cache: old person id → face box (rematchByIoU) */
  rematch: Record<PersonId, Rect> | null;
  /** v1 body cache to merge at the first face answer; its person is the primary (A13) */
  v1Body: V1Bodies | null;
  /** the cache was dropped or lost persons: toast 已重新偵測臉部，部分人物的設定已重設 after the re-detect */
  cacheDropped: boolean;
}
export function openState(entry: HistoryEntry, size: { width: number; height: number }): OpenedState;
export function importEdit(look: CameraLook): EditState;
export function cameraShotEdit(look: CameraLook, seed: FaceSeed): EditState;
```

- [x] **Step 1: Write the failing tests**

```ts
// src/edit/migrate.test.ts
import { describe, expect, it } from 'vitest';
import { applyPreset, defaultParams, sanitizeParams, setParam } from '../engine/params';
import { makeBodyDetection } from '../app/testFakes';
import { makeCache } from '../detect/testCaches';
import { stableKey } from '../store/undo';
import type { HistoryEntry } from '../types';
import { editFromLegacy, legacyProjection, splitLegacy } from './legacy';
import { cameraShotEdit, importEdit, openState } from './migrate';
import { assignPersons, naturalPerson, neutralPerson } from './state';

const SIZE = { width: 2048, height: 1536 };
const v1 = (over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id: 'e',
  createdAt: 1,
  updatedAt: 1,
  original: new Blob([]),
  thumb: new Blob([]),
  params: applyPreset('refined', 1),
  width: 2048,
  height: 1536,
  ...over,
});
const v2 = (over: Partial<HistoryEntry> = {}): HistoryEntry => {
  const edit = assignPersons(editFromLegacy(applyPreset('glow', 1), { primaryInit: true }), ['f0', 'f1'], 'f0');
  const params = sanitizeParams(legacyProjection(edit, 'f0'));
  return v1({ schema: 2, edit, params, paramsKey: stableKey(params), detect: makeCache(), ...over });
};

describe('openState (S §5.3)', () => {
  it('v1, no body: the look on p0 and as primaryInit, the template neutral, detection wanted', () => {
    const o = openState(v1(), SIZE);
    expect(Object.keys(o.edit.persons)).toEqual(['p0']);
    expect(o.edit.primaryInit).toEqual(splitLegacy(applyPreset('refined', 1)).person);
    expect(o.edit.template).toEqual(neutralPerson());
    expect(o).toMatchObject({ detect: null, needsFaceDetect: true, rematch: null, v1Body: null, cacheDropped: false });
    expect(legacyProjection(o.edit, 'p0')).toEqual(applyPreset('refined', 1));
  });
  it('v1 with a body: b0, complete for people = 1 and not for ≥ 2; body null = nobody, complete', () => {
    expect(openState(v1({ body: makeBodyDetection(1) }), SIZE).v1Body).toMatchObject({ complete: true, bodies: [{ id: 'b0' }] });
    expect(openState(v1({ body: makeBodyDetection(3) }), SIZE).v1Body?.complete).toBe(false);
    expect(openState(v1({ body: null }), SIZE).v1Body).toEqual({ bodies: [], complete: true });
  });
  it('v1 with a cache (defensive): p0 goes to the cache primary at once, no detection', () => {
    const o = openState(v1({ detect: makeCache({ primary: 'f1' }) }), SIZE);
    expect(Object.keys(o.edit.persons).sort()).toEqual(['f0', 'f1']);
    expect(o.edit.persons.f1).toEqual(splitLegacy(applyPreset('refined', 1)).person);
    expect(o.needsFaceDetect).toBe(false);
  });
  it('v2 with a fitting cache: used as is, no detector (also at a 1440 decode)', () => {
    const o = openState(v2(), { width: 1440, height: 1080 });
    expect(o.detect).toEqual(makeCache());
    expect(o.needsFaceDetect).toBe(false);
    expect(Object.keys(o.edit.persons).sort()).toEqual(['f0', 'f1']);
  });
  it('v2 with a 基本模式 cache: the cache, plus one detection when a tracker exists', () => {
    const o = openState(v2({ detect: makeCache({ faceScans: [] }) }), SIZE);
    expect(o.detect).not.toBeNull();
    expect(o.needsFaceDetect).toBe(true);
  });
  it('v2 closed before an answer: the stored edit with p0, detection wanted', () => {
    const edit = editFromLegacy(setParam(defaultParams(), 'shape.eyeEnlarge', 0.8), { primaryInit: true });
    const o = openState(v1({ schema: 2, edit, params: legacyProjection(edit, 'p0') }), SIZE);
    expect(o.edit.persons.p0.values['shape.eyeEnlarge']).toBe(0.8);
    expect(o.needsFaceDetect).toBe(true);
  });
  it('v2 whose cache does not fit: dropped, persons kept for the rematch, toast', () => {
    const o = openState(v2(), { width: 1536, height: 2048 });
    expect(o.detect).toBeNull();
    expect(Object.keys(o.edit.persons).sort()).toEqual(['f0', 'f1']);
    expect(o.rematch).toEqual({ f0: makeCache().faces[0].box, f1: makeCache().faces[1].box });
    expect(o).toMatchObject({ needsFaceDetect: true, cacheDropped: true });
  });
  it('v2 whose cache was corrupt: the stale boxes from normalizeEntry drive the rematch', () => {
    const o = openState(v2({ detect: undefined, staleBoxes: { f0: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }, detectLost: true }), SIZE);
    expect(o.rematch).toEqual({ f0: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } });
    expect(o.cacheDropped).toBe(true);
  });
  it('v2 whose edit is unusable opens as v1 from params', () => {
    const o = openState(v1({ schema: 2, edit: undefined }), SIZE);
    expect(Object.keys(o.edit.persons)).toEqual(['p0']);
  });
  it('a paramsKey mismatch (0.3 edited the entry after a rollback) rebuilds the photo and the primary from params', () => {
    const edited = setParam(applyPreset('glow', 1), 'skin.whiten', 0.9);
    const o = openState(v2({ params: sanitizeParams(edited) }), SIZE);
    expect(o.edit.photo.values['skin.whiten']).toBe(0.9);
    expect(o.edit.persons.f0).toEqual(splitLegacy(sanitizeParams(edited)).person);
    expect(o.edit.persons.f1).toEqual(v2().edit!.persons.f1);
  });
});

describe('new photos (RM §3.7)', () => {
  const look = { photo: splitLegacy(defaultParams()).photo, person: naturalPerson() };
  it('an import gives everyone the camera look', () => {
    const e = importEdit(look);
    expect(e.template).toEqual(look.person);
    expect(e.persons.p0).toEqual(look.person);
    expect(e.primaryInit).toBeNull();
  });
  it('a shot seeded on one face: only the primary gets the look; 全部套用 or no face: everyone', () => {
    expect(cameraShotEdit(look, { x: 0.4, y: 0.5 }).template).toEqual(neutralPerson());
    expect(cameraShotEdit(look, { x: 0.4, y: 0.5 }).primaryInit).toEqual(look.person);
    expect(cameraShotEdit(look, 'all').template).toEqual(look.person);
    expect(cameraShotEdit(look, null).template).toEqual(look.person);
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `npx vitest run src/edit/migrate.test.ts`
Expected: FAIL (cannot resolve `./migrate`).

- [x] **Step 3: Write `src/edit/migrate.ts`**

```ts
// Reading a stored entry (lazy migration at open, RM §5.2, S §5.3): HistoryEntry → the edit to open with, the cache to
// trust, and what detection is still owed. Nothing is rewritten in bulk; the first write after an open writes v2.
// The answer-time half (pairing, the p0 hand-over, A13) is firstAnswer (Task 21).
import { boxScore, cachedFits, poseBox, scanned0 } from '../detect/cache';
import { stableKey } from '../store/undo';
import type { CachedBody, CameraLook, DetectionCache, EditState, FaceSeed, HistoryEntry, PersonId, Rect } from '../types';
import { editFromLegacy, splitLegacy } from './legacy';
import { assignPersons, neutralPerson, P0, sanitizeEditState } from './state';

export interface V1Bodies {
  bodies: CachedBody[];
  complete: boolean;
}

export interface OpenedState {
  edit: EditState;
  detect: DetectionCache | null;
  needsFaceDetect: boolean;
  rematch: Record<PersonId, Rect> | null;
  v1Body: V1Bodies | null;
  cacheDropped: boolean;
}

/** the v1 `body` cache as the bodies a first answer merges (b0 = the body 0.3 edited) */
function v1BodiesOf(entry: HistoryEntry): V1Bodies | null {
  if (entry.body === undefined) return null;
  if (entry.body === null) return { bodies: [], complete: true };
  const { pose, mask, people } = entry.body;
  return { bodies: [{ id: 'b0', pose, mask, score: boxScore(poseBox(pose.points)) }], complete: people <= 1 };
}

function boxesOf(cache: DetectionCache): Record<PersonId, Rect> {
  const out: Record<PersonId, Rect> = {};
  for (const p of cache.persons) {
    const f = cache.faces.find((x) => x.id === p.face);
    if (f) out[p.id] = f.box;
  }
  return out;
}

export function openState(entry: HistoryEntry, size: { width: number; height: number }): OpenedState {
  const v2Edit = entry.schema === 2 ? entry.edit : undefined;
  const d = entry.detect;
  const fits = !!d && cachedFits(d, size.width, size.height);
  if (!v2Edit) {
    const edit = editFromLegacy(entry.params, { primaryInit: true });
    if (d && fits) {
      // defensive: 0.4 always writes `edit` together with `detect`
      const ids = d.persons.map((p) => p.id);
      return { edit: assignPersons(edit, ids, d.primary), detect: d, needsFaceDetect: !scanned0(d), rematch: null, v1Body: null, cacheDropped: false };
    }
    return { edit, detect: null, needsFaceDetect: true, rematch: null, v1Body: v1BodiesOf(entry), cacheDropped: false };
  }
  let edit = v2Edit;
  if (entry.paramsKey !== undefined && entry.paramsKey !== stableKey(entry.params)) {
    // 0.3 edited this entry after a rollback: its params win for the photo and the primary person
    const primary = d && fits ? d.primary : P0;
    const split = splitLegacy(entry.params);
    edit = { ...edit, photo: { ...split.photo, legsAnchor: edit.photo.legsAnchor }, persons: { ...edit.persons, [primary]: split.person } };
  }
  if (d && fits) {
    return {
      edit: sanitizeEditState(edit, d.persons.map((p) => p.id)),
      detect: d,
      needsFaceDetect: !scanned0(d),
      rematch: null,
      v1Body: null,
      cacheDropped: entry.detectLost === true,
    };
  }
  if (d || entry.staleBoxes) {
    return { edit, detect: null, needsFaceDetect: true, rematch: d ? boxesOf(d) : (entry.staleBoxes ?? {}), v1Body: null, cacheDropped: true };
  }
  return { edit, detect: null, needsFaceDetect: true, rematch: null, v1Body: v1BodiesOf(entry), cacheDropped: false };
}

/** An imported photo starts from the camera look for everyone (RM §3.7, §12 Q2). */
export function importEdit(look: CameraLook): EditState {
  return { v: 2, photo: look.photo, persons: { [P0]: look.person }, template: look.person, primaryInit: null };
}

/**
 * A camera shot (C2): the look goes to the primary (primaryInit, p0); the others start neutral when one face was
 * beautified (a point seed), or carry the look under 全部套用 / without a face.
 */
export function cameraShotEdit(look: CameraLook, seed: FaceSeed): EditState {
  const point = seed !== null && seed !== 'all';
  return { v: 2, photo: look.photo, persons: { [P0]: look.person }, template: point ? neutralPerson() : look.person, primaryInit: look.person };
}
```

- [x] **Step 4: Run tests**

Run: `npx vitest run src/edit`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/edit/migrate.ts src/edit/migrate.test.ts
git commit -m "v0.4 step 1b: openState (lazy v1/v2 migration), importEdit, cameraShotEdit"
```

---

### Task 10: Port the panel model, `BeautyPanel` and the b4 harness to the lens

**Files:**
- Modify: `src/ui/panelModel.ts:1-20,180-184,186-561` (CRLF), `src/ui/panelModel.test.ts`, `src/ui/editorModel.test.ts:30,334-346`, `src/ui/components/HeightBandOverlay.test.tsx:19,121,293` (CRLF), `src/ui/components/BeautyPanel.tsx:1-170` (CRLF), `tests/harness/b4/main.tsx:130-145,172,211-214,239`

**Interfaces:**
- Consumes: `Lens`, `lensFor`, `P0_INFO` (Task 6), `editFromLegacy`, `legacyProjection` (Task 4).
- Produces (signatures every screen uses from here on):
  - `itemsFor(lens: Lens, sel: PanelSelection, body?: BodyContext): PanelItem[]`
  - `interface ActivateResult { edit: EditState; sel: PanelSelection; changed: boolean; notice?: string }`; `activate(item: PanelItem, lens: Lens, sel: PanelSelection): ActivateResult`
  - `interface SliderBinding { key: string; param: ParamId | null; label: string; bidirectional: boolean; value: number; mixed: boolean; defaultValue: number; apply(lens: Lens, v: number): EditState }`
  - `sliderFor(lens: Lens, sel: PanelSelection, body?: BodyContext): SliderBinding | null`
  - `tabHasValue(lens: Lens, tab: TabId, body?: BodyContext): boolean`
  - `bandOrSuggested(edit: EditState, body: BodyContext | undefined): HeightBand`
  - `BeautyPanel` props: `{ lens: Lens; sel; onSel; onEdit(edit: EditState): void; collapsed?; faceNote?; body?; id? }` (replacing `params` / `onParams`).

- [x] **Step 1: Port the panel tests (they become the failing tests)**

In `src/ui/panelModel.test.ts`:

1. Add imports: `import { lensFor, P0_INFO } from '../edit/lens';`, `import { editFromLegacy, legacyProjection } from '../edit/legacy';`, and add `BeautyParams, EditState` to the `../types` type import.
2. After `byKey` (`:42`) add:

```ts
const lensOfEdit = (e: EditState) => lensFor(e, { kind: 'person', id: 'p0' }, P0_INFO, 'p0');
const lensOf = (p: BeautyParams) => lensOfEdit(editFromLegacy(p));
const proj = (e: EditState) => legacyProjection(e, 'p0');
```

3. Mechanical rewrites over the whole file: `itemsFor(X, ` → `itemsFor(lensOf(X), `; `sliderFor(X, ` → `sliderFor(lensOf(X), `; `tabHasValue(X, ` → `tabHasValue(lensOf(X), `; `bandOrSuggested(X, ` → `bandOrSuggested(editFromLegacy(X), `; `activate(item, X, s)` → `activate(item, lensOf(X), s)`; `r.params.F` → `proj(r.edit).F`; `itemsFor(r.params, ` → `itemsFor(lensOfEdit(r.edit), `; `b.apply(X, v)` → `proj(b.apply(lensOf(X), v))`; `off.params` → `proj(off.edit)`; `activate(item, off.params, s)` / `activate(byKey(…), off.params, s)` → `activate(…, lensOfEdit(off.edit), s)`. In general an `ActivateResult` `x` (`r`, `off`, `again`, or an inline `activate(…)` call) loses `.params`: where a lens is expected (the second argument of `activate`, the first of `itemsFor` / `sliderFor` / `tabHasValue`) write `lensOfEdit(x.edit)`; where `BeautyParams` fields are read write `proj(x.edit)` (so `activate(item, off.params, s).params.bodyProtect` → `proj(activate(item, lensOfEdit(off.edit), s).edit).bodyProtect`, and the ⊘-again check → `activate(itemsFor(lensOfEdit(r.edit), s, ready())[0], lensOfEdit(r.edit), s)`).
4. The five identity checks need one lens for the items and the activation. Rewrite them exactly:

```ts
  it('makeup strip: after picking a shade exactly that shade is selected, not 無', () => {
    const s = sel({ tab: 'makeup', makeupPart: 'lip' });
    const l = lensOf(defaultParams());
    const shade = LIP_SHADES[0].id;
    const r = activate(byKey(itemsFor(l, s), shade), l, s);
    expect(r.changed).toBe(true);
    expect(itemsFor(lensOfEdit(r.edit), s).filter((i) => i.selected).map((i) => i.key)).toEqual([shade]);
  });
```
```ts
  it('tapping the already-selected makeup 無 is a no-op', () => {
    const l = lensOf(defaultParams());
    const s = sel({ tab: 'makeup', makeupPart: 'lip' });
    const r = activate(itemsFor(l, s)[0], l, s);
    expect(r.changed).toBe(false);
    expect(r.edit).toBe(l.edit);
  });
```
```ts
  it('tapping the already-selected preset is a no-op', () => {
    const l = lensOf(defaultParams());
    const s = sel({ tab: 'preset' });
    const r = activate(byKey(itemsFor(l, s), 'natural'), l, s);
    expect(r.changed).toBe(false);
    expect(r.edit).toBe(l.edit);
  });
```
```ts
  it('param tap only changes the selection', () => {
    const l = lensOf(defaultParams());
    const s = sel({ tab: 'shape' });
    const r = activate(byKey(itemsFor(l, s), 'shape.chin'), l, s);
    expect(r.edit).toBe(l.edit);
    expect(r.sel.shape).toBe('shape.chin');
  });
```
```ts
  it('tapping a disabled item only explains why', () => {
    const l = lensOf(defaultParams());
    const s = bodySel('body.waist');
    const r = activate(byKey(itemsFor(l, s, ready()), 'body.legSlim'), l, s);
    expect(r).toMatchObject({ changed: false, notice: LEGS_REASON });
    expect(r.edit).toBe(l.edit);
    expect(r.sel).toBe(s);
  });
```

and in the 增高 test replace `const r = activate(byKey(itemsFor(p, s, ready()), 'height'), p, s); … expect(r.params).toBe(p);` with `const l = lensOf(p); const r = activate(byKey(itemsFor(l, s, ready()), 'height'), l, s); … expect(r.edit).toBe(l.edit);`, then `sliderFor(lensOf(p), r.sel, ctx)!` / `proj(b.apply(lensOf(p), 0.4)).heightBand` / `sliderFor(lensOf(placed), r.sel, ctx)!.value` / `proj(sliderFor(lensOf(placed), r.sel, ctx)!.apply(lensOf(placed), 0.7)).heightBand`. In the 背景保護-without-mask test, `expect(r.params.bodyProtect).toBe(p.bodyProtect)` becomes `expect(proj(r.edit).bodyProtect).toBe(p.bodyProtect)`.

In `src/ui/editorModel.test.ts`, add the same three helpers (and imports) after its imports and rewrite `itemsFor(setParam(…), …)` (`:334`) and `itemsFor(p, s, c)` (`:345`) to `itemsFor(lensOf(…), …)`.

In `src/ui/components/HeightBandOverlay.test.tsx` (CRLF), the other caller of `bandOrSuggested`: add `import { editFromLegacy } from '../../edit/legacy';` next to its `../panelModel` import (`:19`); `bandOrSuggested(p, undefined)` (`:121`) → `bandOrSuggested(editFromLegacy(p), undefined)` and `bandOrSuggested(ed.params, undefined)` (`:293`) → `bandOrSuggested(editFromLegacy(ed.params), undefined)` (the band survives `splitLegacy` unchanged); then run the CRLF normalizer of the Global Constraints on the file.

Run: `npx vitest run src/ui/panelModel.test.ts src/ui/editorModel.test.ts`
Expected: FAIL (type errors / `lens.preset is not a function`: panelModel still takes BeautyParams).

- [x] **Step 2: Port `src/ui/panelModel.ts` (CRLF)**

Replace the imports (`:2-20`) with:

```ts
import { BLUSH_SHADES, FILTERS, hasValue, LIP_SHADES, MAKEUP_PICK_DEFAULT, paramDef, paramsInGroup, PRESETS } from '../engine/params';
import type { Lens } from '../edit/lens';
import type { EditState, HeightBand, ParamId, PresetId, RegionStatus } from '../types';
```

Replace `bandOrSuggested` (`:179-184`) with:

```ts
/** The band the overlay shows: the stored one, else where a new one would start (amount 0). */
export function bandOrSuggested(edit: EditState, body: BodyContext | undefined): HeightBand {
  if (edit.photo.heightBand) return edit.photo.heightBand;
  const s = body?.suggestedBand ?? DEFAULT_BAND;
  return { top: s.top, bottom: s.bottom, amount: 0 };
}
```

Replace everything from `function makeupKey` (`:241`) to the end of the file with:

```ts
function makeupKey(part: MakeupPart): ParamId {
  return part === 'lip' ? 'makeup.lip' : 'makeup.blush';
}

function gated(item: PanelItem, gate: RegionStatus): PanelItem {
  return gate.ok ? item : { ...item, selected: false, disabled: true, reason: gate.reason };
}

function bandActive(edit: EditState): boolean {
  return !!edit.photo.heightBand && edit.photo.heightBand.amount > 0.01;
}

/** ⊘ 原圖 · 增高 · the 10 sliders (PixPretty order) · 背景保護. 增高 sits next to 長腿: both lengthen the legs. */
function bodyItems(lens: Lens, sel: PanelSelection, body: BodyContext | undefined): PanelItem[] {
  const edit = lens.edit;
  const height: PanelItem = {
    key: 'height',
    label: '增高',
    visual: { kind: 'icon', icon: 'height' },
    selected: sel.body === 'height',
    hasValue: bandActive(edit),
    action: { type: 'height' },
    ...ENABLED,
  };
  const sliders = paramsInGroup('body').map(
    (d): PanelItem =>
      gated(
        {
          key: d.id,
          label: d.label,
          visual: { kind: 'icon', icon: d.icon },
          selected: sel.body === d.id,
          hasValue: hasValue(d, lens.get(d.id).value),
          action: { type: 'param', id: d.id },
          ...ENABLED,
        },
        bodyGate(body, d.id),
      ),
  );
  const protect: PanelItem = {
    key: 'protect',
    label: '背景保護',
    visual: { kind: 'icon', icon: edit.photo.bodyProtect ? 'protect' : 'protectOff' },
    selected: false,
    hasValue: false,
    action: { type: 'protect' },
    pressed: edit.photo.bodyProtect,
    ...ENABLED,
  };
  return [gated(RESET_ITEM(), bodyGate(body, 'reset')), gated(height, bodyGate(body, 'height')), ...sliders, gated(protect, bodyGate(body, 'protect'))];
}

/** the preset the 一鍵 strip highlights: the targets' common preset; for a body-only person, the photo's link */
function shownPreset(lens: Lens): PresetId | 'custom' | null {
  const { ref, mixed } = lens.preset();
  if (ref === null) return lens.edit.photo.presetLink?.id ?? null;
  if (mixed) return null;
  return ref === 'custom' ? 'custom' : ref.id;
}

export function itemsFor(lens: Lens, sel: PanelSelection, body?: BodyContext): PanelItem[] {
  const edit = lens.edit;
  switch (sel.tab) {
    case 'preset': {
      const cur = shownPreset(lens);
      const items: PanelItem[] = PRESETS.map((p) => ({
        key: p.id,
        label: p.label,
        visual: { kind: 'icon', icon: PRESET_ICON[p.id] },
        selected: cur === p.id,
        hasValue: false,
        action: { type: 'preset', id: p.id },
        ...ENABLED,
      }));
      if (cur === 'custom') {
        items.push({ key: 'custom', label: '自訂', visual: { kind: 'icon', icon: 'custom' }, selected: true, hasValue: false, action: { type: 'custom' }, ...ENABLED });
      }
      return items;
    }
    case 'skin':
    case 'shape':
      return [
        RESET_ITEM(),
        ...paramsInGroup(sel.tab).map(
          (d): PanelItem => ({
            key: d.id,
            label: d.label,
            visual: { kind: 'icon', icon: d.icon },
            selected: sel[sel.tab as 'skin' | 'shape'] === d.id,
            hasValue: hasValue(d, lens.get(d.id).value),
            action: { type: 'param', id: d.id },
            ...ENABLED,
          }),
        ),
      ];
    case 'body':
      return bodyItems(lens, sel, body);
    case 'filter':
      return FILTERS.map((f) => ({
        key: f.id,
        label: f.label,
        visual: f.id === 'none' ? { kind: 'icon', icon: 'none' } : { kind: 'thumb', src: `/luts/filters/${f.id}_thumb.png` },
        selected: edit.photo.filterId === f.id,
        hasValue: false,
        action: { type: 'filter', id: f.id },
        ...ENABLED,
      }));
    case 'makeup': {
      const part = sel.makeupPart;
      const s = lens.shade(part);
      const on = s.on && !s.mixed;
      const shades = part === 'lip' ? LIP_SHADES : BLUSH_SHADES;
      return [
        // exactly one item is selected in every unmixed state: 無 (off) · 原色 (on, no shade) · a shade
        { ...RESET_ITEM('無'), selected: !s.on && !s.mixed },
        { key: 'orig', label: '原色', visual: { kind: 'swatch', color: null }, selected: on && s.shade === null, hasValue: false, action: { type: 'shade', part, shade: null }, ...ENABLED },
        ...shades.map(
          (x): PanelItem => ({
            key: x.id,
            label: x.label,
            visual: { kind: 'swatch', color: x.color },
            selected: on && s.shade === x.id,
            hasValue: false,
            action: { type: 'shade', part, shade: x.id },
            ...ENABLED,
          }),
        ),
      ];
    }
  }
}

export interface ActivateResult {
  edit: EditState;
  sel: PanelSelection;
  /** false when nothing changed (no undo entry, no haptic) */
  changed: boolean;
  /** text to show as a toast (a disabled item's reason, or what a toggle just did) */
  notice?: string;
}

export function activate(item: PanelItem, lens: Lens, sel: PanelSelection): ActivateResult {
  const a = item.action;
  const edit = lens.edit;
  const done = (next: EditState = edit, nextSel = sel, notice?: string): ActivateResult => ({
    edit: next,
    sel: nextSel,
    changed: next !== edit || nextSel !== sel,
    ...(notice ? { notice } : {}),
  });
  if (item.disabled) return done(edit, sel, item.reason ?? undefined);
  switch (a.type) {
    case 'custom':
      return done();
    case 'preset': {
      const { ref, mixed } = lens.preset();
      const linked = edit.photo.presetLink?.id === a.id;
      // a no-op only when every target already has it (RM §3.3) and the photo part is it too (v0.3: presetId ===)
      if (linked && (ref === null || (ref !== 'custom' && !mixed && ref.id === a.id))) return done();
      // keep the user's 程度 when hopping between presets (not into or out of 原圖); 美體 is outside presets
      const amount = ref !== null && ref !== 'custom' && !mixed && ref.id !== 'original' && a.id !== 'original' && edit.photo.presetLink?.id === ref.id ? ref.amount : 1;
      return done(lens.applyPreset(a.id, amount));
    }
    case 'reset':
      if (sel.tab === 'makeup') {
        const s = lens.shade(sel.makeupPart);
        // already off everywhere: tapping the selected 無 is a no-op (no haptic, no undo step, no flip to 自訂)
        if (!s.on && s.shade === null && !s.mixed) return done();
        return done(lens.clearMakeup(sel.makeupPart));
      }
      // body reset keeps the preset, so an already-neutral body would be an empty undo step
      if (sel.tab === 'body') return lens.groupNeutral('body') ? done() : done(lens.resetGroup('body'));
      if (sel.tab === 'skin' || sel.tab === 'shape' || sel.tab === 'filter') return done(lens.resetGroup(sel.tab));
      return done();
    case 'param':
      if (sel.tab === 'body') return done(edit, sel.body === a.id ? sel : { ...sel, body: a.id });
      return done(edit, sel.tab === 'shape' ? { ...sel, shape: a.id } : { ...sel, skin: a.id });
    case 'height':
      return done(edit, sel.body === 'height' ? sel : { ...sel, body: 'height' });
    case 'protect': {
      const on = !edit.photo.bodyProtect;
      // the measured trade (src/body/straightness.test.ts BODY, slim+waist vs slim+waist_noprotect): on keeps the
      // background deformation in a narrower ring beside the person; off spreads it wider and gentler. Line bend
      // is about the same either way, so neither notice promises straight lines or a smoother outline
      return done(lens.setBodyProtect(on), sel, on ? '背景保護已開啟：背景變形範圍較小' : '背景保護已關閉：背景變形範圍較大但較平緩');
    }
    case 'filter':
      if (edit.photo.filterId === a.id) return done();
      return done(lens.setFilter(a.id));
    case 'shade': {
      const s = lens.shade(a.part);
      if (s.on && !s.mixed && s.shade === a.shade) return done();
      return done(lens.setShade(a.part, a.shade));
    }
  }
}

export interface SliderBinding {
  /** changes when the slider targets a different value (resets drag state) */
  key: string;
  /** the ParamId the slider writes; null for 程度 and 增高 */
  param: ParamId | null;
  label: string;
  bidirectional: boolean;
  value: number;
  /** the targets disagree under 全部 (the label adds 各人不同, Task 22) */
  mixed: boolean;
  /** recommended-default dot / double-tap target */
  defaultValue: number;
  apply(lens: Lens, v: number): EditState;
}

/** 增高 slider: writes the band amount, creating the band where the overlay shows it when there is none yet. */
function heightBinding(edit: EditState, body: BodyContext | undefined): SliderBinding {
  return {
    key: 'body.height',
    param: null,
    label: '增高',
    bidirectional: false,
    value: edit.photo.heightBand?.amount ?? 0,
    mixed: false,
    defaultValue: 0,
    apply: (l, v) => l.setHeightBand({ ...bandOrSuggested(l.edit, body), amount: v }),
  };
}

function paramBinding(lens: Lens, id: ParamId): SliderBinding {
  const d = paramDef(id);
  const g = lens.get(id);
  return { key: d.id, param: d.id, label: d.label, bidirectional: d.bidirectional, value: g.value, mixed: g.mixed, defaultValue: d.default, apply: (l, v) => l.set(d.id, v) };
}

export function sliderFor(lens: Lens, sel: PanelSelection, body?: BodyContext): SliderBinding | null {
  const edit = lens.edit;
  switch (sel.tab) {
    case 'preset': {
      const { ref, mixed } = lens.preset();
      const link = edit.photo.presetLink;
      const id = ref === null ? (link?.id ?? null) : ref !== 'custom' && !mixed ? ref.id : null;
      if (id === null || id === 'original') return null;
      const value = ref !== null && ref !== 'custom' ? ref.amount : (link?.amount ?? 1);
      return { key: `preset.${id}`, param: null, label: '程度', bidirectional: false, value, mixed: false, defaultValue: 1, apply: (l, v) => l.setPresetAmount(v) };
    }
    case 'skin':
    case 'shape':
      return paramBinding(lens, sel[sel.tab]);
    case 'body':
      if (!bodyGate(body, sel.body).ok) return null;
      return sel.body === 'height' ? heightBinding(edit, body) : paramBinding(lens, sel.body);
    case 'filter': {
      if (edit.photo.filterId === 'none') return null;
      const f = FILTERS.find((x) => x.id === edit.photo.filterId);
      return { ...paramBinding(lens, 'filter.amount'), key: `filter.${edit.photo.filterId}`, label: '濾鏡強度', defaultValue: f?.defaultAmount ?? 0.5 };
    }
    case 'makeup': {
      // always shown: dragging to 0 must not unmount the slider mid-gesture; raising it from 0 applies 原色
      const b = paramBinding(lens, makeupKey(sel.makeupPart));
      return { ...b, label: sel.makeupPart === 'lip' ? '口紅' : '腮紅', defaultValue: MAKEUP_PICK_DEFAULT[sel.makeupPart] };
    }
  }
}

/** Accent dot on a tab when anything in its group differs from neutral (美體: a slider or the 增高 band). */
export function tabHasValue(lens: Lens, tab: TabId, body?: BodyContext): boolean {
  switch (tab) {
    case 'preset':
      return false;
    case 'filter':
      return lens.edit.photo.filterId !== 'none';
    case 'body':
      if (body?.status === 'unsupported') return false;
      return bandActive(lens.edit) || lens.groupHasValue('body');
    case 'skin':
    case 'shape':
    case 'makeup':
      return lens.groupHasValue(tab);
  }
}
```

(`PanelItem`, `RESET_ITEM`, `ENABLED`, `PRESET_ICON`, `bodyGate`, `bodyNote`, the constants and `ItemAction` above `makeupKey` are unchanged; delete the old `shadeOf` and `bodyIsNeutral`.)

- [x] **Step 3: Port `BeautyPanel` (CRLF)**

In `src/ui/components/BeautyPanel.tsx`: replace `import type { BeautyParams } from '../../types';` with `import type { Lens } from '../../edit/lens';` and `import type { EditState } from '../../types';`. In `Props`, replace `params: BeautyParams;` with `lens: Lens;` and `onParams(params: BeautyParams): void;` with `onEdit(edit: EditState): void;`. Change the destructuring to `{ lens, sel, onSel, onEdit, collapsed, faceNote, body, id }`, `itemsFor(params, sel, body)` → `itemsFor(lens, sel, body)`, and in `tapItem`: `const r = activate(item, lens, sel);` … `if (r.edit !== lens.edit) onEdit(r.edit);`. The part dot: `const on = lens.shade(p.id).on;`. Tab dots: `tabHasValue(lens, t.id, body)`.

- [x] **Step 4: Port the b4 harness**

`tests/harness/b4/main.tsx`: add `import { lensFor, P0_INFO } from '../../../src/edit/lens';` and `import { editFromLegacy, legacyProjection } from '../../../src/edit/legacy';`. In `Harness()` after `paramsRef.current = params;` add:

```tsx
  const lensOf = (p: BeautyParams) => lensFor(editFromLegacy(p), { kind: 'person', id: 'p0' }, P0_INFO, 'p0');
  const lens = lensOf(params);
  const back = (e: EditState) => legacyProjection(e, 'p0');
```

Then `sliderFor(params, sel, body)` → `sliderFor(lens, sel, body)`; every `binding.apply(paramsRef.current, v)` → `back(binding.apply(lensOf(paramsRef.current), v))`; both `<BeautyPanel params={params} … onParams={(p) => update(p, true)} …/>` → `<BeautyPanel lens={lens} … onEdit={(e) => update(back(e), true)} …/>`; `bandOrSuggested(params, body)` → `bandOrSuggested(editFromLegacy(params), body)`. Add `EditState` to its type import.

- [x] **Step 5: Keep both screens compiling with a one-person shim (Tasks 11 and 12 replace it)**

Both screens still hold `BeautyParams`; give them the same shim the b4 harness uses, so the repository typechecks and behaves exactly as before after this task.

`src/ui/screens/Editor.tsx` (LF): add `import { lensFor, P0_INFO } from '../../edit/lens';`, `import { editFromLegacy, legacyProjection } from '../../edit/legacy';` and `EditState` to its type import; right after `paramsRef.current = params;` (`:79`) add:

```tsx
  // Task 10 shim (removed by Task 12): the panel speaks EditState, the editor still holds BeautyParams
  const lensOfParams = (p: BeautyParams) => lensFor(editFromLegacy(p), { kind: 'person', id: 'p0' }, P0_INFO, 'p0');
  const back = (e: EditState) => legacyProjection(e, 'p0');
```

then: `update(b.apply(paramsRef.current, v), commit)` (`:777`) → `update(back(b.apply(lensOfParams(paramsRef.current), v)), commit)`; `isContourEdit(b.key, …)` → `isContourEdit(b.param ?? b.key, …)`; `sliderFor(params, sel, bodyCtx)` (`:786`) → `sliderFor(lensOfParams(params), sel, bodyCtx)`; `bandOrSuggested(params, bodyCtx)` (`:836`) → `bandOrSuggested(editFromLegacy(params), bodyCtx)`; `<BeautyPanel params={params} … onParams={(p) => update(p, true)}` → `<BeautyPanel lens={lensOfParams(params)} … onEdit={(e) => update(back(e), true)}`.

`src/ui/screens/Camera.tsx` (CRLF): same two module imports, and `BeautyParams, EditState` added to its `../../types` type import (today it imports only `CameraController, CameraSnapshot`); inside `Camera()` after `paramsRef.current = params;` add the same two shim lines; `sliderFor(params, sel, cameraBody)` → `sliderFor(lensOfParams(params), sel, cameraBody)`; both slider handlers `setParams(binding.apply(paramsRef.current, v))` → `setParams(back(binding.apply(lensOfParams(paramsRef.current), v)))`; `<BeautyPanel … params={params} … onParams={setParams}` → `lens={lensOfParams(params)}` and `onEdit={(e) => setParams(back(e))}`.

- [x] **Step 6: Run the tests and the typecheck**

Run: `npx vitest run src/ui src/edit && npm run typecheck`
Expected: PASS; `tsc` exits 0.

Run: `npm run build && npx playwright test tests/e2e/parity.spec.ts tests/e2e/editor.spec.ts tests/e2e/camera.spec.ts`
Expected: PASS (the panel behaves as in v0.3 for one person).

- [x] **Step 7: Commit**

```bash
git add src/ui/panelModel.ts src/ui/panelModel.test.ts src/ui/editorModel.test.ts src/ui/components/HeightBandOverlay.test.tsx src/ui/components/BeautyPanel.tsx src/ui/screens/Editor.tsx src/ui/screens/Camera.tsx tests/harness/b4/main.tsx
git commit -m "v0.4 step 1b: panel model and BeautyPanel read and write through the lens"
```

---

### Task 11: Camera look (`meiyan.look.v1`) and the camera on the lens

**Files:**
- Modify: `src/store/settings.ts:7-31,104-113`, `src/store/settings.test.ts` (append), `src/ui/state.ts:2-4,17-25,50-63,74-117` (CRLF), `src/ui/deps.ts:12,60-61` (CRLF), `src/ui/update.ts:8,90,112` (LF), `src/ui/screens/Camera.tsx` (CRLF), `src/ui/screens/Review.tsx:84-92` (CRLF), `src/ui/flows.ts:32` (CRLF), `tests/harness/t7/fakes.ts:376-378,452-453`, `tests/harness/t7/main.tsx` (unchanged: it still passes `params: defaultParams()`), `tests/e2e/camera.spec.ts:58-61`

**Interfaces:**
- Consumes: `cameraEdit`, `lookOf`, `LIVE` (Task 4), `splitLegacy`, `legacyProjection` (Task 4), `sanitizePhoto`, `sanitizePerson`, `naturalPerson` (Task 5), `lensFor` (Task 6).
- Produces: `LOOK_KEY = 'meiyan.look.v1'`; `loadLook(): CameraLook` (migrates `meiyan.params.v1` through `splitLegacy` on the first load and writes `meiyan.look.v1`, leaving `meiyan.params.v1` untouched); `saveLook(l: CameraLook): void`; `sanitizeLook(raw: unknown): CameraLook`; `AppState.look: CameraLook` (replacing `params`); `setLook(look: CameraLook)`, `flushLook()` (replacing `setParams` / `flushParams`); `Shot.look: CameraLook` (replacing `params`); `deps.loadLook`, `deps.saveLook` (replacing `loadParams`, `saveParams`); `LIVE_PERSONS: readonly PersonInfo[] = [{id: 'live', face: true, body: false}]` (exported from `src/edit/lens.ts`).

- [x] **Step 1: Write the failing settings tests** (append to `src/store/settings.test.ts`; add `LOOK_KEY, loadLook, saveLook` to the `./settings` import and `import { splitLegacy } from '../edit/legacy';`)

```ts
describe('camera look meiyan.look.v1 (RM §3.7, C3)', () => {
  it('first load without it migrates meiyan.params.v1 and leaves that key alone', () => {
    const p = setParam(applyPreset('glow', 1), 'skin.whiten', 0.9);
    store.setItem(PARAMS_KEY, JSON.stringify(p));
    const look = loadLook();
    expect(look).toEqual(splitLegacy(p));
    expect(JSON.parse(store.getItem(LOOK_KEY)!)).toEqual(look);
    expect(JSON.parse(store.getItem(PARAMS_KEY)!)).toEqual(p);
  });
  it('round-trips and sanitizes', () => {
    const look = splitLegacy(applyPreset('refined', 0.4));
    saveLook(look);
    expect(loadLook()).toEqual(look);
    store.setItem(LOOK_KEY, JSON.stringify({ photo: { filterId: 'nope' }, person: { values: { 'skin.smooth': 7 } } }));
    const s = loadLook();
    expect(s.photo.filterId).toBe('none');
    expect(s.person.values['skin.smooth']).toBe(1);
  });
  it('a fresh install gets the 自然 look; hasSavedSettings sees the new key', () => {
    expect(loadLook()).toEqual(splitLegacy(defaultParams()));
    store.clear();
    expect(hasSavedSettings()).toBe(false);
    store.setItem(LOOK_KEY, '{}');
    expect(hasSavedSettings()).toBe(true);
  });
});
```

(add `hasSavedSettings` to the import if the file does not import it yet.)

Run: `npx vitest run src/store/settings.test.ts`
Expected: FAIL (`loadLook` not exported).

- [x] **Step 2: Implement in `src/store/settings.ts`**

Add imports `import { splitLegacy } from '../edit/legacy';`, `import { naturalPerson, sanitizePerson, sanitizePhoto } from '../edit/state';` and `CameraLook` to the type import. After `savePrefs` add:

```ts
export const LOOK_KEY = 'meiyan.look.v1';

/** Untrusted camera look → valid (RM §3.7): every field defaulted; no geometry / spots / strokes in the camera. */
export function sanitizeLook(raw: unknown): CameraLook {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return { photo: sanitizePhoto(r.photo), person: sanitizePerson(r.person, naturalPerson()) };
}

/**
 * The live-camera look. The first load without meiyan.look.v1 migrates meiyan.params.v1 (0.3) through splitLegacy and
 * stores the result; meiyan.params.v1 is neither written nor deleted (RM §3.7).
 */
export function loadLook(): CameraLook {
  const raw = readJson(LOOK_KEY);
  if (raw !== undefined) return sanitizeLook(raw);
  const look = splitLegacy(loadParams());
  writeJson(LOOK_KEY, look);
  return look;
}

export function saveLook(l: CameraLook): void {
  writeJson(LOOK_KEY, sanitizeLook(l));
}
```

In `hasSavedSettings` (`:109`): `(s.getItem(PARAMS_KEY) !== null || s.getItem(PREFS_KEY) !== null || s.getItem(LOOK_KEY) !== null)`.

Note: `sanitizePerson(…, naturalPerson())` over `splitLegacy(defaultParams()).person` returns it unchanged, so a fresh install equals 自然 (the test asserts it).

- [x] **Step 3: App state (`src/ui/state.ts`, CRLF)**

- Imports: keep `defaultParams` (the fallback below); add `import { splitLegacy } from '../edit/legacy';`; add `CameraLook` to the type import (keep `BeautyParams`: `EditorSource.params` still uses it until Task 12).
- `Shot`: replace `params: BeautyParams;` with `/** the camera look at the shutter (RM §3.7) */ look: CameraLook;`.
- `AppState`: replace `params: BeautyParams;` with `/** live-camera look (persisted as meiyan.look.v1); the editor keeps its own per-photo edit */ look: CameraLook;`.
- Store init: `look: safeLoad(() => deps.loadLook(), () => splitLegacy(defaultParams()), 'loadLook'),`.
- Rename `flushParams` → `flushLook` (body: `deps.saveLook(app.get().look)`, error tag `'saveLook'`) and `setParams` → `setLook(look: CameraLook)` (`app.set({ look })`); update the two listeners at `:112-117` to `flushLook`.

`src/ui/update.ts` (LF), the other caller of `flushParams`: the `./state` import (`:8`) and both calls (`onNeedReload` `:90`, `applyUpdate` `:112`) become `flushLook`.

`src/ui/deps.ts` (CRLF): import `loadLook, saveLook` instead of `loadParams, saveParams`; the `deps` object lists `loadLook, saveLook` in their place.

`tests/harness/t7/fakes.ts`: `import { splitLegacy } from '../../../src/edit/legacy';`; replace `loadParams: () => defaults.params, saveParams: () => undefined,` with `loadLook: () => splitLegacy(defaults.params), saveLook: () => undefined,`.

- [x] **Step 4: Camera on the lens (`src/ui/screens/Camera.tsx`, CRLF)**

1. Imports: replace `setParams` with `setLook` in the `../state` import; the lens import becomes `import { lensFor, LIVE_PERSONS } from '../../edit/lens';`, the legacy import `import { legacyProjection } from '../../edit/legacy';`; add `import { cameraEdit, LIVE, lookOf } from '../../edit/state';` (`EditState` is already in the type import since Task 10; drop `BeautyParams` from it, unused once the shim is gone).
2. Replace `const params = useStore(app, (s) => s.params);` (`:36`) with `const look = useStore(app, (s) => s.look);` and `paramsRef` (`:57-58`) with `const lookRef = useRef(look); lookRef.current = look;`. Delete the Task 10 shim lines (`lensOfParams`, `back`) and add in their place:

```tsx
  /** the camera is one person, 'live' (RM §3.7): the panel uses the editor's lens and code */
  const lensOf = (l: typeof look) => lensFor(cameraEdit(l), { kind: 'person', id: LIVE }, LIVE_PERSONS, LIVE);
  const setEdit = (e: EditState) => setLook(lookOf(e));
```

3. `useFilterLoader(bundle?.engine ?? null, params.filterId)` → `look.photo.filterId`.
4. `getParams: () => paramsRef.current,` → `getParams: () => legacyProjection(cameraEdit(lookRef.current), LIVE),` (the live loop keeps its `BeautyParams` input until Task 18).
5. Shot: `{ image, file, original, look: lookRef.current }`.
6. `sliderFor(lensOfParams(params), sel, cameraBody)` → `sliderFor(lensOf(look), sel, cameraBody)`; the slider handlers: `onChange={(v) => binding && setEdit(binding.apply(lensOf(lookRef.current), v))}` and the same for `onCommit`.
7. `<BeautyPanel … lens={lensOfParams(params)} … onEdit={(e) => setParams(back(e))} …/>` → `lens={lensOf(look)}` and `onEdit={setEdit}`.

In `src/edit/lens.ts` add, below `P0_INFO`:

```ts
/** the camera's one person: a face, never a body (美體 is photo-only) */
export const LIVE_PERSONS: readonly PersonInfo[] = [{ id: 'live', face: true, body: false }];
```

- [x] **Step 5: Review and flows keep the v0.3 editor input for one more task**

`src/ui/screens/Review.tsx:91`: `params: shot.params` → `params: legacyProjection(cameraEdit(shot.look), LIVE)` (imports `legacyProjection` from `../../edit/legacy`, `cameraEdit, LIVE` from `../../edit/state`). `src/ui/flows.ts:32`: `params: opts.params ?? app.get().params` → `params: opts.params ?? legacyProjection(cameraEdit(app.get().look), LIVE)` with the same imports. (Task 12 replaces both with `EditState` sources.)

- [x] **Step 6: The e2e poll (intended change #5)**

`tests/e2e/camera.spec.ts:59-61`:

```ts
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('meiyan.look.v1') ?? '{}').photo?.values?.['skin.whiten']))
    .toBe(1);
```

- [x] **Step 7: Run tests**

Run: `npx vitest run src/store src/ui src/edit && npm run typecheck`
Expected: PASS; `tsc` exits 0.

Run: `npm run build && npx playwright test tests/e2e/camera.spec.ts tests/e2e/parity.spec.ts tests/e2e/settings.spec.ts`
Expected: PASS (the persisted look is now polled from `meiyan.look.v1`).

- [x] **Step 8: Commit**

```bash
git add src/store/settings.ts src/store/settings.test.ts src/ui/state.ts src/ui/deps.ts src/ui/update.ts src/ui/screens/Camera.tsx src/ui/screens/Review.tsx src/ui/flows.ts src/edit/lens.ts tests/harness/t7/fakes.ts tests/e2e/camera.spec.ts
git commit -m "v0.4 step 1b: camera look meiyan.look.v1 and the camera panel on the lens"
```

---

### Task 12: The editor on `EditState`, v2 history writes, `openState` at open (sub-step 1b gate)

**Files:**
- Modify: `src/ui/state.ts:27-40` (EditorSource, CRLF), `src/ui/flows.ts:15-45` (CRLF), `src/ui/flows.test.ts:41-66`, `src/ui/screens/Home.tsx:85-105` (CRLF), `src/ui/screens/Review.tsx:84-92` (CRLF), `src/ui/faceProtectModel.ts:130-148`, `src/ui/faceProtectModel.test.ts:640-655,760-772`, `src/ui/screens/Editor.tsx` (regions listed in Step 4)

**Interfaces:**
- Consumes: `openState`, `importEdit`, `cameraShotEdit` (Task 9), `lensFor`, `P0_INFO` (Task 6), `legacyProjection` (Task 4), `editKey`, `P0` (Task 4), `UndoOptions` (Task 7), `sanitizeParams` (`params.ts`), `stableKey` (`undo.ts`).
- Produces:
  - `EditorSource` (from here on): `{ bitmap; edit: EditState; historyId; detect: DetectionCache | null; needsFaceDetect: boolean; rematch: Record<PersonId, Rect> | null; v1Body: V1Bodies | null; cacheDropped: boolean; faceSeed: FaceSeed; body?: BodyDetection | null /* 1b only, removed by Task 21 */; faceProtect?; faceMask?; returnTo }`.
  - `freshSource(bitmap: ImageBitmap, edit: EditState, returnTo: EditorSource['returnTo'], faceSeed?: FaceSeed): EditorSource` (`src/ui/flows.ts`).
  - `openInEditor(blob: Blob, opts: { entry?: HistoryEntry | null; returnTo: EditorSource['returnTo'] }): Promise<void>`.
  - `paramsPatch(edit: EditState, primary: PersonId, limit: FaceProtectRecord, maskStored: boolean, thumb?: Blob): { schema: 2; edit: EditState; params: BeautyParams; paramsKey: string; thumb?: Blob; faceProtect: boolean; faceMask?: PersonMask }`.

- [x] **Step 1: Port the failing tests first**

`src/ui/faceProtectModel.test.ts` (`:760-772`) becomes:

```ts
describe('paramsPatch (M2: every params write carries the limit record; RM §5.1 v2 fields)', () => {
  const e = editFromLegacy(applyPreset('natural', 1));
  const params = sanitizeParams(legacyProjection(e, 'p0'));
  const v2 = { schema: 2, edit: e, params, paramsKey: stableKey(params) };
  it('the request rides along with the edit and its legacy projection, also without a thumbnail', () => {
    expect(paramsPatch(e, 'p0', { faceProtect: true }, true)).toEqual({ ...v2, faceProtect: true });
    expect(paramsPatch(e, 'p0', { faceProtect: false }, true)).toEqual({ ...v2, faceProtect: false });
  });
  it('the segmenter mask only while none is stored; a thumbnail when given', () => {
    const m = mask();
    const t = new Blob(['t']);
    expect(paramsPatch(e, 'p0', { faceProtect: true, faceMask: m }, false, t)).toEqual({ ...v2, thumb: t, faceProtect: true, faceMask: m });
    expect(paramsPatch(e, 'p0', { faceProtect: true, faceMask: m }, true, t)).toEqual({ ...v2, thumb: t, faceProtect: true });
  });
});
```

and at `:647` `paramsPatch(p, rec, maskStored, blob)` → `paramsPatch(editFromLegacy(p), 'p0', rec, maskStored, blob)`. Imports to add: `editFromLegacy, legacyProjection` (`../edit/legacy`), `sanitizeParams` (`../engine/params`), `stableKey` (`../store/undo`).

`src/ui/flows.test.ts`, the two entry tests (`:41-66`): build entries and pass them:

```ts
  const entry = (over: Partial<HistoryEntry>): HistoryEntry => ({
    id: 'e1', createdAt: 1, updatedAt: 1, original: new Blob([]), thumb: new Blob([]), params: defaultParams(), width: 4, height: 3, ...over,
  });
```

`flows.openInEditor(new Blob([]), { historyId: 'e1', faceProtect: true, faceMask, returnTo: 'home' })` → `flows.openInEditor(new Blob([]), { entry: entry({ faceProtect: true, faceMask }), returnTo: 'home' })`; the second → `{ entry: entry({ id: 'e2' }), returnTo: 'home' }`. Add one assertion to the first: `expect(screen.source.edit.persons.p0).toBeDefined();`. Imports: `defaultParams` from `../engine/params`, `HistoryEntry` type.

Run: `npx vitest run src/ui/faceProtectModel.test.ts src/ui/flows.test.ts`
Expected: FAIL (old signatures).

- [x] **Step 2: `paramsPatch` v2 (`src/ui/faceProtectModel.ts:130-148`)**

```ts
/**
 * The params write of an existing history entry (an updateEntry patch), and of addEntry. Every params write goes
 * through it, so the v2 fields (RM §5.1: schema, edit, its legacy projection for a rollback to 0.3, paramsKey) and
 * the limit record always ride along together. The segmenter mask is the same for the whole photo: written only while
 * none is stored yet (`maskStored`); a stored one is kept (updateEntry never removes it).
 */
export function paramsPatch(
  edit: EditState,
  primary: PersonId,
  limit: FaceProtectRecord,
  maskStored: boolean,
  thumb?: Blob,
): { schema: 2; edit: EditState; params: BeautyParams; paramsKey: string; thumb?: Blob; faceProtect: boolean; faceMask?: PersonMask } {
  const params = sanitizeParams(legacyProjection(edit, primary));
  return {
    schema: 2,
    edit,
    params,
    paramsKey: stableKey(params),
    ...(thumb ? { thumb } : {}),
    faceProtect: limit.faceProtect,
    ...(limit.faceMask && !maskStored ? { faceMask: limit.faceMask } : {}),
  };
}
```

Imports: `sanitizeParams` (`../engine/params`), `legacyProjection` (`../edit/legacy`), `stableKey` (`../store/undo`), types `EditState, PersonId`.

- [x] **Step 3: EditorSource, flows, Home, Review**

`src/ui/state.ts` (CRLF): replace `EditorSource` (`:27-40`) with:

```ts
export interface EditorSource {
  /** owned by the editor session afterwards */
  bitmap: ImageBitmap;
  /** the edit to open with: openState for an entry, importEdit / cameraShotEdit for a new photo */
  edit: EditState;
  /** existing history entry being re-edited, or null for a new photo */
  historyId: string | null;
  /** the entry's detection cache, trusted as is (openState checked cachedFits); null = none or dropped */
  detect: DetectionCache | null;
  /** one face detection is owed (a tracker permitting): no cache, a 基本模式 cache, or a dropped one */
  needsFaceDetect: boolean;
  /** a dropped cache: the old persons' face boxes (rematchByIoU, S §5.3) */
  rematch: Record<PersonId, Rect> | null;
  /** a v1 entry's cached bodies (b0), merged at the first face answer (A13) */
  v1Body: V1Bodies | null;
  /** the cache was dropped or lost persons: toast after the re-detect */
  cacheDropped: boolean;
  /** camera → editor: the beautified face (C2) */
  faceSeed: FaceSeed;
  /** sub-step 1b only (Task 21 removes it): the v1 body detection the 美體 tab starts from */
  body?: BodyDetection | null;
  /** the entry was saved with the 瘦臉 background limit requested (HistoryEntry.faceProtect): reopening requests it again */
  faceProtect?: boolean;
  /** the entry's cached segmenter mask for that limit (HistoryEntry.faceMask) */
  faceMask?: PersonMask;
  returnTo: 'home' | 'camera';
}
```

(types: `DetectionCache, EditState, FaceSeed, PersonId, Rect` from `../types`, where `BeautyParams` is dropped: nothing in `state.ts` uses it any more; `V1Bodies` from `../edit/migrate`.)

`src/ui/flows.ts` (CRLF): replace `openInEditor` (`:15-45`) with:

```ts
/** A new photo's editor source (an import or a camera shot): nothing cached, one detection owed. */
export function freshSource(bitmap: ImageBitmap, edit: EditState, returnTo: EditorSource['returnTo'], faceSeed: FaceSeed = null): EditorSource {
  return { bitmap, edit, historyId: null, detect: null, needsFaceDetect: true, rematch: null, v1Body: null, cacheDropped: false, faceSeed, returnTo };
}

/** Decode a photo (file or history original) and open it in the editor; an entry goes through openState (S §5.3). */
export async function openInEditor(blob: Blob, opts: { entry?: HistoryEntry | null; returnTo: EditorSource['returnTo'] }): Promise<void> {
  app.set({ busy: '正在開啟照片…' });
  try {
    const bitmap = await deps.importPhoto(blob, maxImportEdge());
    const entry = opts.entry ?? null;
    let source: EditorSource;
    if (entry) {
      const o = openState(entry, { width: bitmap.width, height: bitmap.height });
      source = { ...freshSource(bitmap, o.edit, opts.returnTo), historyId: entry.id, detect: o.detect, needsFaceDetect: o.needsFaceDetect, rematch: o.rematch, v1Body: o.v1Body, cacheDropped: o.cacheDropped };
      if (entry.body !== undefined) source.body = entry.body;
      if (entry.faceProtect === true) source.faceProtect = true;
      if (entry.faceMask) source.faceMask = entry.faceMask;
    } else source = freshSource(bitmap, importEdit(app.get().look), opts.returnTo);
    go({ name: 'editor', source });
  } catch (e) {
    toast(`無法開啟照片：${reportError(e, 'importPhoto')}`, 4000);
  } finally {
    app.set({ busy: null });
  }
}
```

Imports: `openState, importEdit` (`../edit/migrate`), types `EditState, FaceSeed, HistoryEntry` (replacing the `BeautyParams` type import of `:2`). Drop the now-unused `legacyProjection`/`cameraEdit` imports added in Task 11.

`src/ui/screens/Home.tsx` (CRLF) `openEntry`: replace the `openInEditor(entry.original, {…})` call with `await openInEditor(entry.original, { entry, returnTo: 'home' });`.

`src/ui/screens/Review.tsx` (CRLF) `edit()`: `go({ name: 'editor', source: freshSource(shot.original, cameraShotEdit(shot.look, null), 'camera') });` (imports `freshSource` from `../flows`, `cameraShotEdit` from `../../edit/migrate`; drop the Task 11 imports). Task 25 passes the real seed.

- [x] **Step 4: Editor on `EditState` (`src/ui/screens/Editor.tsx`, LF)**

Make exactly these edits (line numbers are today's):

1. Imports: delete `import { applyPreset, setHeightBand } from '../../engine/params';` (`:19`); keep the Task 10 lens import; the legacy import becomes `import { legacyProjection } from '../../edit/legacy';`; add `import { editKey, P0 } from '../../edit/state';`; the type import (`:21`) becomes `import type { BeautyParams, BodyDetection, BodyField, EditState, Engine, Face, PersonId } from '../../types';`.
2. Delete `const keyOf = (p: BeautyParams) => JSON.stringify(p);` (`:68`) and the two Task 10 shim lines (`lensOfParams`, `back`).
3. Replace `:77-79` (the `params` state and `paramsRef`) with:

```tsx
  const [edit, setEditState] = useState<EditState>(source.edit);
  const editRef = useRef(edit);
  editRef.current = edit;
  /** sub-step 1b: one implicit person until the detection cache lands (Task 21) */
  const primary: PersonId = P0;
  const lensOf = (e: EditState) => lensFor(e, { kind: 'person', id: primary }, P0_INFO, primary);
  /** the engine, the 美體 field and the 瘦臉 limit draw the 0.3 view of the edit until Task 18 */
  const params = useMemo(() => legacyProjection(edit, primary), [edit]);
  const paramsRef = useRef(params);
  paramsRef.current = params;
```

4. `saved` init (`:102`): `source.historyId ? { key: editKey(source.edit), field: ANY_FIELD } : null`.
5. Undo (`:152-161`): `useMemo<UndoLike<EditState> | null>`, `deps.createUndo<EditState>(50, { clone: false, key: editKey })`, `u.reset(source.edit)`.
6. `update` (`:169-180`): signature `(e: EditState, commit: boolean)`, `setEditState(e)`, `undo.push(e)`.
7. `queueHistory` (`:268-278`): signature `(e: EditState, gen: number, img: ImageData, s: StillSession)`, `const stamp: OutputStamp = { key: editKey(e), field: gen };`, `.then(() => writeHistory(e, img, s, limit))`.
8. `writeParams` (`:290-293`): `async (id: string, e: EditState, limit: FaceProtectRecord, thumb?: Blob) => { await deps.updateEntry(id, paramsPatch(e, primary, limit, faceMaskStored.current, thumb)); … }`.
9. `writeHistory` (`:299-318`): first parameter `e: EditState`; `await writeParams(historyId.current, e, limit, thumb);` and in `addEntry` `...paramsPatch(e, primary, limit, faceMaskStored.current),`.
10. `flushHistory` (`:343-384`): replace `const p = paramsRef.current; const key = keyOf(p);` with `const e = editRef.current; const p = paramsRef.current; const key = editKey(e);`; `writeParams(id, p, limit)` → `writeParams(id, e, limit)`; `queueHistory(p, gen, …)` → `queueHistory(e, gen, …)`; `writeHistory(p, s.exportImageData(p, field), s, limitRecord(s))` → `writeHistory(e, s.exportImageData(p, field), s, limitRecord(s))`.
11. Encode effect (`:626-669`): `const key = editKey(edit);`; both `keyOf(paramsRef.current) !== key` / `=== key` → `editKey(editRef.current) !== key` / `=== key`; `queueHistory(params, gen, img, s)` → `queueHistory(edit, gen, img, s)`; the dependency list `[session, params, lost, fieldTick, protectTick]` → `[session, edit, lost, fieldTick, protectTick]`. (`encode(s, params, field)` and `s.prepareExport(params)` keep `params`.)
12. `save` (`:700-737`): `const key = editKey(edit);` and `keyOf(paramsRef.current) === key` → `editKey(editRef.current) === key`.
13. `doUndo` / `doRedo`: `const e = undo.undo();` / `undo.redo()`, `if (e) setEditState(e);`.
14. `reset` (`:768`): `update(lensOf(editRef.current).reset(), true);`.
15. `slide` (`:772-778`): the shim line `update(back(b.apply(lensOfParams(paramsRef.current), v)), commit);` → `update(b.apply(lensOf(editRef.current), v), commit);` (`isContourEdit(b.param ?? b.key, …)` stays).
16. Render (`:786`): `const lens = lensOf(edit);` and `sliderFor(lensOfParams(params), sel, bodyCtx)` → `sliderFor(lens, sel, bodyCtx)`.
17. `HeightBandOverlay` (`:835-839`): `band={bandOrSuggested(edit, bodyCtx)}`, `onChange={(b, commit) => update(lensOf(editRef.current).setHeightBand(b), commit)}`.
18. `BeautyPanel` (`:869-876`): `lens={lens}` and `onEdit={(e) => update(e, true)}`.

Everything else (the 美體 detection reading `source.body`, `BodyFieldMemo`, `protectSrc`, `useFilterLoader(…, params.filterId)`, `session.render(params)`) keeps using `params`, the projection.

- [x] **Step 5: Full gate of sub-step 1b**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green.

Run: `npx playwright test tests/e2e/parity.spec.ts tests/e2e/editor.spec.ts tests/e2e/camera.spec.ts tests/e2e/home.spec.ts tests/e2e/body.spec.ts tests/e2e/faceProtect.spec.ts`
Expected: PASS (parity max ≤ 1/255; the editor spec's autosave/reopen and 98-after-flush assertions prove the v2 writes; camera.spec reads `meiyan.look.v1`).

Run: `npm run test:e2e`
Expected: every spec passes.

- [x] **Step 6: Commit**

```bash
git add src/ui/state.ts src/ui/flows.ts src/ui/flows.test.ts src/ui/screens/Home.tsx src/ui/screens/Review.tsx src/ui/faceProtectModel.ts src/ui/faceProtectModel.test.ts src/ui/screens/Editor.tsx
git commit -m "v0.4 step 1b: the editor edits an EditState, writes HistoryEntry v2, opens entries through openState"
```

---

## Sub-step 1c — Detection, persons, the N-face engine and the multi-person field

### Task 13: Multi-face tracker (T1, T2) and `prepareFaces` (T3)

**Files:**
- Modify: `src/types.ts:228-243` (Tracker, CRLF), `src/tracking/tracker.ts:46-57,108-122,193-199,236-270,338-389` (CRLF), `src/tracking/tracker.test.ts`, `src/app/testFakes.ts:32-40,189-211` (CRLF), `src/app/still.ts:296-310`, `src/app/still.test.ts:36`, `src/app/live.ts:166-174` (CRLF), `tests/harness/t3/harness.ts`, `tests/harness/b3/tracker.ts:74`, `tests/harness/t7/fakes.ts:402`
- Create: `src/detect/faces.ts`, `src/detect/faces.test.ts`; add `ovalBox` to `src/engine/passes/faceCap.ts` (new file; Task 16 extends it)

**Interfaces:**
- Consumes: `adapt` (`adapter111.ts:106`), limits (`EDIT_DETECT_FACES`, `LIVE_DETECT_FACES`, `MAX_EDIT_FACES`, `MIN_FACE_FRAC`, `MAX_OBSTACLES`), `boxScore` (Task 8).
- Produces:
  - `Tracker.detectVideo(video, tsMs, opts: { maxFaces: number }): Landmarks478[] | null` (null = no answer; `[]` = a completed inference without a face, A5); `Tracker.detectImage(image, opts: { maxFaces: number }): Landmarks478[]` (`[]` = no face or not known).
  - `ovalBox(face: Face): Rect` (oval bbox clipped to [0,1], `src/engine/passes/faceCap.ts`).
  - `src/detect/faces.ts`: `interface PreparedFace { id: string; face: Face; box: Rect; lm: Float32Array }`; `interface PreparedFaces { faces: PreparedFace[]; obstacles: CachedObstacle[]; dropped: { tooSmall: number; overCap: number } }`; `boxIoU(a: Rect, b: Rect): number`; `prepareFaces(lms: readonly Landmarks478[], width: number, height: number, cap?: number): PreparedFaces`; `adaptCached(c: CachedFace, width: number, height: number): Face`; `EMPTY_PREPARED: PreparedFaces`.
  - `fakeTracker(clock?, face = true, count = 1)` with `count` and `unusable` fields; `makeLandmarks(tag = 0)`; `makeFace(tag = 0, cx = 0.5)` now has a circle oval of radius 0.2 around `(cx, 0.5)` (identity-only tests are unaffected).

- [x] **Step 1: Port the existing tracker tests and add the T1/T2 cases**

In `src/tracking/tracker.test.ts`:
1. Record the create options in the fake: add `opts: { numFaces?: number; runningMode?: string };` to `FakeLandmarkerT` and `opts: o,` to the object built in `createFromOptions` (type `o` as `{ canvas?: FakeCanvas; baseOptions: { delegate: string }; numFaces?: number; runningMode?: string }`).
2. Add `const ONE = { maxFaces: 1 };` after `const image = …` and pass it to every existing call: `t.detectVideo(video, N)` → `t.detectVideo(video, N, ONE)`, `t.detectImage(image)` → `t.detectImage(image, ONE)`.
3. Replace `expect(t.detectImage(image, ONE)).toBeNull()` with `.toEqual([])` and `expect(t.detectImage(image, ONE)).not.toBeNull()` with `.toHaveLength(1)`; every `setOptions` expectation `{ runningMode: 'X' }` becomes `{ runningMode: 'X', numFaces: 1 }` (`:146, :272, :289, :291`).
4. Append:

```ts
describe('createTracker: multiple faces (S §3.4 T1, T2)', () => {
  const lmAt = (n: number) => ({ faceLandmarks: Array.from({ length: n }, () => FACE) });
  it('numFaces travels with runningMode in one setOptions; no call when neither changes', async () => {
    const t = await make();
    const lm = last();
    expect(lm.opts.numFaces).toBe(1); // the first instance: LIVE_DETECT_FACES
    t.detectImage(image, { maxFaces: 8 });
    t.detectImage(image, { maxFaces: 8 });
    expect(lm.setOptions.mock.calls).toEqual([[{ runningMode: 'IMAGE', numFaces: 8 }]]);
    t.detectVideo(video, 1, { maxFaces: 1 });
    expect(lm.setOptions).toHaveBeenLastCalledWith({ runningMode: 'VIDEO', numFaces: 1 });
  });
  it('maxFaces is clamped to 1…EDIT_DETECT_FACES', async () => {
    const t = await make();
    const lm = last();
    t.detectImage(image, { maxFaces: 99 });
    expect(lm.setOptions).toHaveBeenLastCalledWith({ runningMode: 'IMAGE', numFaces: 8 });
    t.detectImage(image, { maxFaces: Number.NaN });
    expect(lm.setOptions).toHaveBeenLastCalledWith({ runningMode: 'IMAGE', numFaces: 1 });
  });
  it('a replacement is built with the last requested count, so the next call makes no setOptions', async () => {
    const t = await make();
    t.detectVideo(video, 1, { maxFaces: 3 });
    last().canvas!.lose(true);
    await vi.advanceTimersByTimeAsync(5000);
    const second = last();
    expect(second.opts.numFaces).toBe(3);
    expect(t.detectVideo(video, 2, { maxFaces: 3 })).toHaveLength(1);
    expect(second.setOptions).not.toHaveBeenCalled();
  });
  it('keeps every valid face in result order, [] for none; detectVideo: null for no answer, [] for no face', async () => {
    const t = await make();
    last().detect.mockReturnValueOnce({ faceLandmarks: [FACE, FACE.slice(0, 10), FACE] });
    expect(t.detectImage(image, { maxFaces: 4 })).toHaveLength(2);
    last().detectForVideo.mockReturnValueOnce(lmAt(0));
    expect(t.detectVideo(video, 1, { maxFaces: 3 })).toEqual([]);
    expect(t.detectVideo({ readyState: 1, videoWidth: 640, videoHeight: 480 } as unknown as HTMLVideoElement, 2, { maxFaces: 3 })).toBeNull();
  });
});
```

Run: `npx vitest run src/tracking/tracker.test.ts`
Expected: FAIL (extra arguments ignored; `toEqual([])` gets `null`; no `numFaces` key).

- [x] **Step 2: Tracker types and implementation**

`src/types.ts` (CRLF), `Tracker` (`:228-243`):

```ts
export interface Tracker {
  /** Delegate of the current graph; re-read it on onStateChange('ok'): a rebuild under 'auto' may fall back to CPU. */
  readonly delegate: Delegate;
  /**
   * VIDEO mode; tsMs must be strictly increasing. null = no answer (closed, frame not ready, tracker unusable, rebuild
   * throttled); [] = a completed inference without a face (A5). `maxFaces` is required (clamped to 1…EDIT_DETECT_FACES)
   * and travels with the mode in one setOptions: options are sticky, and every change rebuilds the graph. Throws on
   * inference failure: the tracker rebuilds its graph on the next call.
   */
  detectVideo(video: HTMLVideoElement, tsMs: number, opts: { maxFaces: number }): Landmarks478[] | null;
  /**
   * IMAGE mode on the same instance; the next detectVideo switches back. [] = no face, or not known (recovering /
   * unusable): callers keep the health check (editorModel.ts detectSession). Throws as detectVideo.
   */
  detectImage(image: ImageBitmap | HTMLCanvasElement | HTMLImageElement, opts: { maxFaces: number }): Landmarks478[];
  close(): void;
}
```

`src/tracking/tracker.ts` (CRLF):
1. Import `import { EDIT_DETECT_FACES, LIVE_DETECT_FACES } from '../config/limits';`.
2. Replace `toLandmarks` (`:46-57`) with:

```ts
/** Every face with a full 478-point set, in MediaPipe's result order; [] for none. */
function toLandmarksAll(faces: { x: number; y: number; z: number }[][]): Landmarks478[] {
  const out: Landmarks478[] = [];
  for (const face of faces) {
    if (!face || face.length < N_POINTS) continue;
    const points = new Float32Array(N_POINTS * 3);
    for (let i = 0; i < N_POINTS; i++) {
      const q = face[i];
      points[i * 3] = q.x;
      points[i * 3 + 1] = q.y;
      points[i * 3 + 2] = q.z;
    }
    out.push({ points });
  }
  return out;
}

/** maxFaces → numFaces: 1…EDIT_DETECT_FACES (NaN → 1) */
export function clampFaces(n: number): number {
  return Number.isFinite(n) ? Math.min(EDIT_DETECT_FACES, Math.max(1, Math.floor(n))) : 1;
}
```

3. `createInstance(fileset, modelBuffer, delegate, onLost, numFaces: number)`: `numFaces: 1,` → `numFaces,`. `createFirst(…, onFail, numFaces: number)` passes it through.
4. In `createTracker`: declare `let faces = LIVE_DETECT_FACES;` before the first `createFirst` call and pass `faces` as its last argument; in `replace()` pass `faces` to `createFirst` too (the new graph starts in VIDEO with the last requested count).
5. `succeeded` becomes generic: `const succeeded = <T>(r: T): T => { … }`.
6. `setMode` (`:338-352`):

```ts
  const setMode = (m: 'VIDEO' | 'IMAGE', n: number) => {
    if (mode === m && faces === n && !needsRebuild) return;
    // Mode and count first: on a poisoned graph setOptions applies the new options and starts the new graph,
    // then throws while closing the old one, so the graph is in (m, n) either way. Both keys every time: the
    // bundle writes numFaces only when the key is present, and options are sticky.
    mode = m;
    faces = n;
    if (needsRebuild) {
      needsRebuild = false;
      lastRebuildAt = performance.now();
    }
    try {
      Promise.resolve(inst.landmarker.setOptions({ runningMode: m, numFaces: n })).catch((e: unknown) => note('rebuild', e));
    } catch (e) {
      note('rebuild', e);
    }
  };
```

7. `detectVideo(video, tsMs, opts)`: keep the early `return null`s; `setMode('VIDEO', clampFaces(opts.maxFaces));` and `return succeeded(toLandmarksAll(inst.landmarker.detectForVideo(frame, ts).faceLandmarks));`.
8. `detectImage(image, opts)`: the early returns become `return [];`; `setMode('IMAGE', clampFaces(opts.maxFaces));` and `return succeeded(toLandmarksAll(inst.landmarker.detect(image).faceLandmarks));`.

Run: `npx vitest run src/tracking/tracker.test.ts`
Expected: PASS.

- [x] **Step 3: Write the failing `prepareFaces` tests**

```ts
// src/detect/faces.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Landmarks478 } from '../types';
import { boxIoU, prepareFaces } from './faces';

const fx = (n: string) => JSON.parse(readFileSync(new URL(`../../tests/fixtures/${n}`, import.meta.url), 'utf8'));
const sample = fx('landmarks_sample_face.json') as { points: number[] };

/** the recorded sample face moved so its points' bbox is centred at (cx, cy) with width w (UV), same aspect */
function lmAt(cx: number, cy: number, w: number): Landmarks478 {
  const p = sample.points;
  let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
  for (let i = 0; i < 478; i++) {
    x0 = Math.min(x0, p[i * 3]); x1 = Math.max(x1, p[i * 3]);
    y0 = Math.min(y0, p[i * 3 + 1]); y1 = Math.max(y1, p[i * 3 + 1]);
  }
  const s = w / (x1 - x0);
  const out = new Float32Array(478 * 3);
  for (let i = 0; i < 478; i++) {
    out[i * 3] = cx + (p[i * 3] - (x0 + x1) / 2) * s;
    out[i * 3 + 1] = cy + (p[i * 3 + 1] - (y0 + y1) / 2) * s;
    out[i * 3 + 2] = p[i * 3 + 2] * s;
  }
  return { points: out };
}

describe('prepareFaces (S §3.4 T3)', () => {
  it('orders by box centre x, ids f0…, boxes are oval bboxes in [0,1]', () => {
    const r = prepareFaces([lmAt(0.7, 0.5, 0.2), lmAt(0.3, 0.5, 0.2)], 1000, 1000);
    expect(r.faces.map((f) => f.id)).toEqual(['f0', 'f1']);
    expect(r.faces[0].box.x + r.faces[0].box.w / 2).toBeLessThan(0.5);
    for (const f of r.faces) expect(f.box.x >= 0 && f.box.x + f.box.w <= 1).toBe(true);
    expect(r.dropped).toEqual({ tooSmall: 0, overCap: 0 });
  });
  it('drops a duplicate (IoU > 0.6) entirely, before the size filter', () => {
    const r = prepareFaces([lmAt(0.5, 0.5, 0.2), lmAt(0.51, 0.5, 0.2)], 1000, 1000);
    expect(r.faces).toHaveLength(1);
    expect(r.obstacles).toHaveLength(0);
  });
  it('faces narrower than MIN_FACE_FRAC of the short edge become obstacles (tooSmall)', () => {
    const r = prepareFaces([lmAt(0.3, 0.5, 0.2), lmAt(0.8, 0.8, 0.02)], 1000, 1000);
    expect(r.faces).toHaveLength(1);
    expect(r.obstacles).toHaveLength(1);
    expect(r.obstacles[0].oval).toHaveLength(72);
    expect(r.dropped.tooSmall).toBe(1);
  });
  it('beyond the cap the largest are kept; the rest are obstacles (overCap)', () => {
    const lms = [0.1, 0.3, 0.5, 0.7, 0.9].map((x, i) => lmAt(x, 0.5, 0.08 + i * 0.01));
    const r = prepareFaces(lms, 1000, 1000, 3);
    expect(r.faces).toHaveLength(3);
    expect(r.faces.map((f) => Math.round((f.box.x + f.box.w / 2) * 10) / 10)).toEqual([0.5, 0.7, 0.9]);
    expect(r.dropped.overCap).toBe(2);
    expect(r.obstacles).toHaveLength(2);
  });
  it('drops non-finite or collapsed faces before they get an id (Review Focus #1)', () => {
    const bad = lmAt(0.3, 0.5, 0.2);
    bad.points[5] = Number.NaN;
    const flat: Landmarks478 = { points: new Float32Array(478 * 3).fill(0.5) };
    const r = prepareFaces([bad, flat, lmAt(0.7, 0.5, 0.2)], 1000, 1000);
    expect(r.faces.map((f) => f.id)).toEqual(['f0']);
    expect(r.faces[0].box.x).toBeGreaterThan(0.5);
    expect(r.obstacles).toHaveLength(0);
  });
  it('the recorded group_faces.png gives A, B and C; D (if MediaPipe saw it) is an obstacle', () => {
    const j = fx('group_faces.landmarks.json') as { width: number; height: number; faces: number[][] };
    const r = prepareFaces(j.faces.map((f) => ({ points: new Float32Array(f) })), j.width, j.height);
    expect(r.faces.map((f) => Math.round((f.box.x + f.box.w / 2) * 20) / 20)).toEqual([0.2, 0.55, 0.8]);
    expect(r.obstacles.length).toBe(j.faces.length - 3);
  });
  it('boxIoU', () => {
    expect(boxIoU({ x: 0, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 1, h: 1 })).toBe(1);
    expect(boxIoU({ x: 0, y: 0, w: 1, h: 1 }, { x: 2, y: 2, w: 1, h: 1 })).toBe(0);
  });
});
```

(The `Math.round(c·20)/20` buckets put A's centre ≈ 0.22 at 0.2, B ≈ 0.55 at 0.55, C ≈ 0.82 at 0.8; if PD2 moved C, update that number from the regenerated JSON.)

Run: `npx vitest run src/detect/faces.test.ts`
Expected: FAIL (cannot resolve `./faces`).

- [x] **Step 4: Write `ovalBox` and `src/detect/faces.ts`**

`src/engine/passes/faceCap.ts` (new; Task 16 extends it):

```ts
// Per-face geometry shared by the detection cache, the face table and the caps (S §4.1, §4.4).
import type { Face, Rect } from '../../types';

/** FACE_OVAL bbox clipped to [0,1] (the box maskCoversFace uses, faceProtectModel.ts:63-72) */
export function ovalBox(face: Face): Rect {
  const o = face.oval;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i + 1 < o.length; i += 2) {
    x0 = Math.min(x0, o[i]);
    x1 = Math.max(x1, o[i]);
    y0 = Math.min(y0, o[i + 1]);
    y1 = Math.max(y1, o[i + 1]);
  }
  const cx0 = Math.max(0, Math.min(1, x0));
  const cy0 = Math.max(0, Math.min(1, y0));
  const cx1 = Math.max(0, Math.min(1, x1));
  const cy1 = Math.max(0, Math.min(1, y1));
  return Number.isFinite(cx0 + cy0 + cx1 + cy1) ? { x: cx0, y: cy0, w: cx1 - cx0, h: cy1 - cy0 } : { x: 0, y: 0, w: 0, h: 0 };
}

export const boxCentre = (b: Rect): [number, number] => [b.x + b.w / 2, b.y + b.h / 2];
```

`src/detect/faces.ts`:

```ts
// Detected faces → the faces a photo keeps (S §3.4 T3): adapt, box, dedupe, size filter, cap, order, ids, obstacles.
// Pure. The ids are persisted in the cache and never recomputed, so a different result order on another decode or
// delegate cannot swap identities.
import { MAX_EDIT_FACES, MAX_OBSTACLES, MIN_FACE_FRAC } from '../config/limits';
import { ovalBox } from '../engine/passes/faceCap';
import { adapt } from '../tracking/adapter111';
import type { CachedFace, CachedObstacle, Face, Landmarks478, Rect } from '../types';

export interface PreparedFace {
  id: string;
  face: Face;
  box: Rect;
  /** the raw 478×3 landmarks (cached, so a later adapter change needs no re-detection) */
  lm: Float32Array;
}
export interface PreparedFaces {
  faces: PreparedFace[];
  obstacles: CachedObstacle[];
  dropped: { tooSmall: number; overCap: number };
}
export const EMPTY_PREPARED: PreparedFaces = { faces: [], obstacles: [], dropped: { tooSmall: 0, overCap: 0 } };

export function boxIoU(a: Rect, b: Rect): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/** a cached face as the engine needs it (adapt at this decode's size: normalized, so any size works) */
export function adaptCached(c: CachedFace, width: number, height: number): Face {
  return adapt({ points: c.lm }, width, height);
}

export function prepareFaces(lms: readonly Landmarks478[], width: number, height: number, cap = MAX_EDIT_FACES): PreparedFaces {
  // (1) adapt, (2) box; a non-finite or collapsed face never gets an id (Review Focus #1)
  const all: { face: Face; box: Rect; lm: Float32Array; area: number }[] = [];
  for (const l of lms) {
    if (l.points.length < 478 * 3) continue;
    const lm = l.points.slice(0, 478 * 3);
    if (!lm.every(Number.isFinite)) continue;
    const face = adapt({ points: lm }, width, height);
    const box = ovalBox(face);
    if (!(box.w > 0 && box.h > 0)) continue;
    all.push({ face, box, lm, area: box.w * box.h });
  }
  // (3) a duplicate (IoU > 0.6) is the same face: keep the larger, drop the other entirely
  all.sort((a, b) => b.area - a.area);
  const unique: typeof all = [];
  for (const f of all) if (!unique.some((u) => boxIoU(u.box, f.box) > 0.6)) unique.push(f);
  // (4) the size filter, (5) the cap (largest first: `unique` is sorted by area)
  const short = Math.min(width, height);
  const obstacles: CachedObstacle[] = [];
  const big: typeof all = [];
  let tooSmall = 0;
  for (const f of unique) {
    if (f.box.w * width < MIN_FACE_FRAC * short) {
      tooSmall++;
      obstacles.push({ box: f.box, oval: f.face.oval });
    } else big.push(f);
  }
  const kept = big.slice(0, cap);
  for (const f of big.slice(cap)) obstacles.push({ box: f.box, oval: f.face.oval });
  // (6) display order: box centre x, y breaking ties within 0.01; (7) ids in that order
  const cx = (b: Rect) => b.x + b.w / 2;
  const cy = (b: Rect) => b.y + b.h / 2;
  kept.sort((a, b) => (Math.abs(cx(a.box) - cx(b.box)) > 0.01 ? cx(a.box) - cx(b.box) : cy(a.box) - cy(b.box)));
  return {
    faces: kept.map((f, i) => ({ id: `f${i}`, face: f.face, box: f.box, lm: f.lm })),
    obstacles: obstacles.slice(0, MAX_OBSTACLES),
    dropped: { tooSmall, overCap: Math.max(0, big.length - cap) },
  };
}
```

- [x] **Step 5: Port the callers (behaviour unchanged until Task 18)**

- `src/app/still.ts` `detectOnce` (`:296-310`): `const lms = tracker.detectImage(bitmap, { maxFaces: 1 });` then `const dbg = debugState(); if (dbg) dbg.detectCalls++;` and `return { face: lms.length ? adapt(lms[0], width, height) : null, known: true };`. (Task 18 switches to `EDIT_DETECT_FACES` + `prepareFaces`.)
- `src/app/still.test.ts:36`: `toHaveBeenCalledWith(bmp)` → `toHaveBeenCalledWith(bmp, { maxFaces: 1 })`.
- `src/app/live.ts` (CRLF) `detectFace` (`:166-174`): `const lms = t.detectVideo(video, performance.now(), { maxFaces: LIVE_DETECT_FACES }); return lms && lms.length ? adapt(lms[0], w, h) : null;` (import `LIVE_DETECT_FACES` from `../config/limits`).
- `src/app/testFakes.ts` (CRLF): replace `makeFace` / `makeLandmarks` (`:32-40`) with:

```ts
export function makeFace(tag = 0, cx = 0.5): Face {
  const pts111 = new Float32Array(222).fill(0.5);
  pts111[0] = tag;
  // a non-degenerate oval (radius 0.2 around (cx, 0.5)): prepareFaces keeps it
  const oval = new Float32Array(72);
  for (let i = 0; i < 36; i++) {
    oval[i * 2] = cx + 0.2 * Math.cos((i / 36) * 2 * Math.PI);
    oval[i * 2 + 1] = 0.5 + 0.2 * Math.sin((i / 36) * 2 * Math.PI);
  }
  return { pts111, ext: new Float32Array(16), oval, yaw: 0 };
}

/** `tag` lands in the first coordinate (0.5 + tag/1000), so a mocked adapt can tell results apart */
export function makeLandmarks(tag = 0): Landmarks478 {
  const points = new Float32Array(478 * 3).fill(0.5);
  points[0] = 0.5 + tag / 1000;
  return { points };
}
```

and `FakeTracker` / `fakeTracker` (`:189-211`):

```ts
export interface FakeTracker extends Tracker {
  face: boolean;
  /** faces per detection */
  count: number;
  /** detectVideo answers null (no answer) while set */
  unusable: boolean;
  /** simulated cost of each detect call, ms */
  cost: number;
  detectVideo: ReturnType<typeof vi.fn<Tracker['detectVideo']>>;
  detectImage: ReturnType<typeof vi.fn<Tracker['detectImage']>>;
}

export function fakeTracker(clock?: { work(ms: number): void }, face = true, count = 1): FakeTracker {
  const faces = () => Array.from({ length: t.count }, (_, i) => makeLandmarks(i));
  const t = {
    delegate: 'GPU' as const,
    face,
    count,
    unusable: false,
    cost: 0,
    detectVideo: vi.fn(() => {
      clock?.work(t.cost);
      if (t.unusable) return null;
      return t.face ? faces() : [];
    }),
    detectImage: vi.fn(() => (t.face ? faces() : [])),
    close: vi.fn(),
  };
  return t as unknown as FakeTracker;
}
```

- `tests/harness/t3/harness.ts`: add near the top

```ts
const img1 = (t: Tracker, x: Parameters<Tracker['detectImage']>[0]) => t.detectImage(x, { maxFaces: 1 })[0] ?? null;
const vid1 = (t: Tracker, v: HTMLVideoElement, ts: number) => {
  const r = t.detectVideo(v, ts, { maxFaces: 1 });
  return r === null ? null : (r[0] ?? null);
};
```

(import the `Tracker` type if absent) and replace every `tracker.detectImage(X)` with `img1(tracker, X)` and every `tracker.detectVideo(V, T)` with `vid1(tracker, V, T)`.
- `tests/harness/b3/tracker.ts:74`: `tracker.detectVideo(big as unknown as HTMLVideoElement, 1000 + i * 33)` — this is a BodyTracker call; leave it (Task 14 ports body calls).
- `tests/harness/t7/fakes.ts:402`: `detectVideo: () => null, detectImage: () => null` → `detectVideo: () => null, detectImage: () => []`.

- [x] **Step 6: Run everything touched**

Run: `npx vitest run src/tracking src/detect src/app && npm run typecheck`
Expected: PASS; `tsc` exits 0.

Run: `npm run build && npx playwright test tests/e2e/parity.spec.ts tests/e2e/editor.spec.ts tests/e2e/camera.spec.ts`
Expected: PASS (`numFaces` 1 on both paths: v0.3 behaviour).

- [x] **Step 7: Commit**

```bash
git add src/types.ts src/tracking/tracker.ts src/tracking/tracker.test.ts src/app/testFakes.ts src/app/still.ts src/app/still.test.ts src/app/live.ts src/detect/faces.ts src/detect/faces.test.ts src/engine/passes/faceCap.ts tests/harness/t3/harness.ts tests/harness/t7/fakes.ts
git commit -m "v0.4 step 1c: multi-face tracker API (numFaces with the mode) and prepareFaces"
```

---

### Task 14: Every body and mask from the pose model (P1, P2)

**Files:**
- Modify: `src/types.ts:195-209` (BodyTracker, CRLF), `src/tracking/bodyTracker.ts:154-183,236-252,288-293,438-480`, `src/tracking/bodyTracker.test.ts`, `src/tracking/bodyTracker.fuzz.test.ts`, `src/detect/cache.ts` (append `primaryBody`), `src/ui/editorModel.ts:120-138`, `src/ui/editorModel.test.ts:205-250`, `src/ui/screens/Editor.tsx:445-465`, `src/app/testFakes.ts:220-260` (CRLF), `src/bench/main.ts:600-615` (CRLF), `scripts/record-pose.mjs:35` (CRLF), `tests/harness/b3/tracker.ts:53-76`, `tests/harness/t7/fakes.ts:415-425`

**Interfaces:**
- Consumes: `MAX_EDIT_BODIES`, `boxScore`, `poseBox` (Task 8).
- Produces: `BodyTracker.detect(image): BodyDetections | null`, `BodyTracker.detectVideo(video, tsMs): BodyDetections | null`; `poseScore(pose: readonly NormalizedLandmark[]): number`; `toDetections(result, width, height): BodyDetections | null` (replacing `toDetection`); `primaryBody(d: BodyDetections | null): BodyDetection | null` (`src/detect/cache.ts`: v0.3's choice, used until Task 21); `detectBody(…)` resolves `BodyDetections | null | undefined`; `makeBodyDetections(n = 1): BodyDetections`; `fakeBodyTracker(result?: BodyDetections | null)`.

- [x] **Step 1: Failing tests**

In `src/tracking/bodyTracker.test.ts`:
1. `FakeMask` gains `close: ReturnType<typeof vi.fn>`; `mask()` returns `{ width: w, height: hh, getAsFloat32Array: () => a, close: vi.fn() }`.
2. Intended change #1 (`:206-212`): `numPoses: 2` → `numPoses: 4` in the title and the `toMatchObject`.
3. Intended change #2 (`:185-201`): the `toDetection` test becomes:

```ts
  it('toDetections keeps the original size, every person with ≥ 33 points and each one’s own mask', async () => {
    const { toDetections } = await load();
    const small = person(0.05, 0.15, 0.5, 0.7);
    const big = person(0.3, 0.7, 0.05, 0.95);
    const d = toDetections(
      result([small, big], [mask(100, 100, (x) => (x < 10 ? 1 : 0)), mask(100, 100, (x) => (x >= 50 ? 1 : 0))]) as never,
      4000,
      3000,
    )!;
    expect(d.bodies).toHaveLength(2);
    expect([d.width, d.height]).toEqual([4000, 3000]);
    expect(d.bodies[1].pose.points[0]).toBeCloseTo(0.3, 6);
    expect(d.bodies[1].mask!.data[99]).toBe(255);
    expect(d.bodies[0].mask!.data[0]).toBe(255);
    expect(d.bodies[1].score).toBeGreaterThan(d.bodies[0].score);
    expect(toDetections(result([]) as never, 10, 10)).toBeNull();
    expect(toDetections(result([big.slice(0, 20)]) as never, 10, 10)).toBeNull();
  });

  it('reads one mask at a time, empties segmentationMasks before close(), closes each mask once, also after a throw (P2)', async () => {
    const { toDetections } = await load();
    let live = 0;
    let peak = 0;
    const counted = () => {
      const m = mask(64, 64, () => 1);
      return {
        ...m,
        getAsFloat32Array: () => {
          live++;
          peak = Math.max(peak, live);
          return m.getAsFloat32Array();
        },
        close: vi.fn(() => {
          live--;
        }),
      };
    };
    const ms = [counted(), counted(), counted()];
    const r = result([person(0.1, 0.3, 0.1, 0.9), person(0.4, 0.6, 0.1, 0.9), person(0.7, 0.9, 0.1, 0.9)], ms);
    toDetections(r as never, 10, 10);
    expect(peak).toBe(1);
    expect(r.segmentationMasks).toEqual([]);
    for (const m of ms) expect(m.close).toHaveBeenCalledTimes(1);
    const boom = { ...counted(), getAsFloat32Array: () => { throw new Error('readback'); } };
    const later = counted();
    expect(() => toDetections(result([person(0.1, 0.3, 0.1, 0.9), person(0.4, 0.6, 0.1, 0.9)], [boom, later]) as never, 10, 10)).toThrow('readback');
    expect(boom.close).toHaveBeenCalledTimes(1);
    expect(later.close).toHaveBeenCalledTimes(1);
  });
```

4. Every other assertion reading a detection from `t.detect(…)` / `t.detectVideo(…)` (`det.mask`, `det.people`, `det.pose`) reads it through `primaryBody(...)`: add `import { primaryBody } from '../detect/cache';` and wrap, e.g. `const det = primaryBody(t.detect(img(…)))!;`. In `bodyTracker.fuzz.test.ts:230`, `const det = v ? t.detectVideo(video, h.clock) : t.detect(img);` stays; its trace line `:232` reads the mask, so `det.mask ? 'ok+mask' : 'ok'` → `det.bodies.some((b) => b.mask) ? 'ok+mask' : 'ok'` (the fuzz fakes' masks have no `close()`: `toDetections` swallows that throw like a lost-context one).

In `src/ui/editorModel.test.ts` (the three `detectBody` tests, `:205-264`): `const t = fakeBodyTracker(det);` → `const dets = makeBodyDetections(1); const t = fakeBodyTracker(dets);` and `toBe(det)` → `toBe(dets)` (import `makeBodyDetections`; the third test, `:260-264`, only needs the tracker).

Run: `npx vitest run src/tracking/bodyTracker.test.ts src/ui/editorModel.test.ts`
Expected: FAIL (`toDetections` missing; `numPoses` 2).

- [x] **Step 2: Implement**

`src/types.ts` (CRLF), `BodyTracker`: `detect(image: ImageBitmap | HTMLCanvasElement): BodyDetections | null;` and `detectVideo(video: HTMLVideoElement, tsMs: number): BodyDetections | null;` (doc: "every person with ≥ 33 points; null when nobody").

`src/tracking/bodyTracker.ts`:
1. `import { MAX_EDIT_BODIES } from '../config/limits';`, `import { boxScore, poseBox } from '../detect/cache';`; add `BodyDetections` to the type import.
2. Above `selectPerson`:

```ts
/** selectPerson's score of one pose: the clipped landmark bbox's area × centrality (detect/cache.ts boxScore) */
export function poseScore(pose: readonly NormalizedLandmark[]): number {
  const pts = new Float32Array(pose.length * 4);
  pose.forEach((p, i) => {
    pts[i * 4] = p.x;
    pts[i * 4 + 1] = p.y;
  });
  return boxScore(poseBox(pts));
}
```

and make `selectPerson` use it: replace its loop body with `const score = poseScore(pose); if (score > bestScore) { bestScore = score; best = i; }` (same numbers: `boxScore(poseBox)` is the formula of `:166-176`).
3. Replace `toDetection` (`:236-252`) with:

```ts
interface MaskLike {
  width: number;
  height: number;
  getAsFloat32Array(): Float32Array;
  close(): void;
}

/**
 * Every person of a raw result (≥ 33 points), each with its own downscaled mask (P2). In tasks-vision 0.10.35
 * getAsFloat32Array caches the array inside the mask until mask.close(), and result.close() only closes the masks; so
 * the masks are taken out of the result first, read one at a time, and closed right after their downscale: at most one
 * full-size array plus one transient readback buffer is alive. Every mask is closed exactly once, also after a throw.
 */
export function toDetections(
  result: { landmarks: NormalizedLandmark[][]; segmentationMasks?: MaskLike[] },
  width: number,
  height: number,
): BodyDetections | null {
  const masks = [...(result.segmentationMasks ?? [])];
  (result as { segmentationMasks?: MaskLike[] }).segmentationMasks = [];
  const closed = new Set<number>();
  const close = (i: number) => {
    if (closed.has(i) || !masks[i]) return;
    closed.add(i);
    try {
      masks[i].close();
    } catch {
      // a lost context can make close() throw; the readback is gone either way
    }
  };
  try {
    const bodies: BodyDetections['bodies'] = [];
    result.landmarks.forEach((pose, i) => {
      const m = masks[i];
      const valid = pose.length >= N_POSE_POINTS;
      const mask = valid && m && m.width > 0 && m.height > 0 ? downscaleMask(m.getAsFloat32Array(), m.width, m.height) : null;
      close(i);
      if (valid) bodies.push({ pose: { points: toPose33(pose) }, mask, score: poseScore(pose) });
    });
    return bodies.length ? { bodies, width, height } : null;
  } finally {
    for (let i = 0; i < masks.length; i++) close(i);
  }
}
```

4. `numPoses: 2,` → `numPoses: MAX_EDIT_BODIES,` (`:292`); update the header comment "IMAGE with numPoses 2" → "IMAGE with numPoses MAX_EDIT_BODIES (4)".
5. In `run` (`:438-480`): `let det: BodyDetections | null;`, `det = toDetections(result as never, sw, sh);`, and `if (live.delegate === 'GPU' && det?.bodies.some((b) => b.mask)) gpuProven = true;`; the return type of `run` becomes `BodyDetections | null`.

`src/detect/cache.ts` (append; add `BodyDetection, BodyDetections` to its type import):

```ts
/** v0.3's choice among the detected bodies (selectPerson: the first best score) as the v1 shape; until Task 21 */
export function primaryBody(d: BodyDetections | null): BodyDetection | null {
  if (!d || !d.bodies.length) return null;
  const best = d.bodies.reduce((a, b) => (b.score > a.score ? b : a));
  return { pose: best.pose, mask: best.mask, people: d.bodies.length, width: d.width, height: d.height };
}
```

`src/ui/editorModel.ts` `detectBody` (`:120-138`): return type `Promise<BodyDetections | null | undefined>` (types import `BodyDetections`); the body is unchanged (`return t.detect(image);`).

`src/ui/screens/Editor.tsx` `startBodyDetection` (`:445-465`): `(dets) => { if (dets === undefined || unmounted.current) return; setBodyDet({ phase: 'done', det: primaryBody(dets) }); persistBody(); }` (import `primaryBody` from `../../detect/cache`).

`src/app/testFakes.ts` (CRLF): keep `makeBodyDetection`; add

```ts
/** `n` standing persons side by side (makeBodyDetection's pose shifted), each with its 4×8 mask */
export function makeBodyDetections(n = 1, width = 1536, height = 2048): BodyDetections {
  const one = makeBodyDetection(1, width, height);
  const bodies = Array.from({ length: n }, (_, i) => {
    const points = one.pose.points.slice();
    const dx = n === 1 ? 0 : (i - (n - 1) / 2) * (0.6 / n);
    for (let k = 0; k < 33; k++) points[k * 4] += dx;
    return { pose: { points }, mask: one.mask, score: 0.3 - Math.abs(dx) };
  });
  return { bodies, width, height };
}
```

and change `FakeBodyTracker.result` to `BodyDetections | null` with `fakeBodyTracker(result: BodyDetections | null = makeBodyDetections())`.

Port the other callers through `primaryBody`: `src/bench/main.ts` (CRLF) `const detect = (): BodyDetection | null => primaryBody(cfg.mode === 'IMAGE' ? tracker.detect(bitmap) : tracker.detectVideo(frame as unknown as HTMLVideoElement, (ts += 33)));`; `tests/harness/b3/tracker.ts` wrap `base`, `upscaled`, `two`, `empty`, `y`, `back` and the `vids.push(…)` argument in `primaryBody(…)`; `tests/harness/t7/fakes.ts` fake `createBodyTracker`: return `{ bodies: [{ pose: det.pose, mask: det.mask, score: 1 }], width: det.width, height: det.height }` where it returned `det` (`null` stays `null`: `pose=none`); `scripts/record-pose.mjs` (CRLF) single mode: after `const det = tracker.detect(bitmap);` insert `const best = det && det.bodies.reduce((a, b) => (b.score > a.score ? b : a));` and read `best.pose.points`, `best.mask`, `people: det.bodies.length`, `width: det.width`, `height: det.height`.

- [x] **Step 3: Run**

Run: `npx vitest run src/tracking src/ui src/detect && npm run typecheck`
Expected: PASS; `tsc` exits 0.

Run: `npm run build && npx playwright test tests/e2e/body.spec.ts tests/e2e/parity.spec.ts`
Expected: PASS (the editor still edits v0.3's chosen body).

- [x] **Step 4: Commit**

```bash
git add src/types.ts src/tracking/bodyTracker.ts src/tracking/bodyTracker.test.ts src/tracking/bodyTracker.fuzz.test.ts src/detect/cache.ts src/ui/editorModel.ts src/ui/editorModel.test.ts src/ui/screens/Editor.tsx src/app/testFakes.ts src/bench/main.ts scripts/record-pose.mjs tests/harness/b3/tracker.ts tests/harness/t7/fakes.ts
git commit -m "v0.4 step 1c: every body and mask from the pose model, one readback at a time (numPoses 4)"
```

---

### Task 15: Persons — pairing, primary, seed, hit test, and building the cache

**Files:**
- Create: `src/detect/persons.ts`, `src/detect/persons.test.ts`
- Modify: `src/detect/cache.ts` (append), `src/detect/cache.test.ts` (append)

**Interfaces:**
- Consumes: `PreparedFaces` (Task 13), `boxScore`, `poseBox`, `noFaceCache` (Task 8), `boxIoU`, `adaptCached` (Task 13), `maskCoversFace` (`faceProtectModel.ts:59`), `fieldAt` (`body/cpuWarp.ts:7`), `SEED_BOX_PAD`.
- Produces (`src/detect/persons.ts`):

```ts
export interface PairFace { id: string; face: Face; box: Rect }
export interface PairBody { id: string; pose: Pose33; mask: PersonMask | null }
/** face id → body id pairs, greedy 1:1 by ascending cost (S §3.4 P4) */
export function pairPersons(faces: readonly PairFace[], bodies: readonly PairBody[], aspect: number): [string, string][];
export function pairCost(face: Face, pose: Pose33, aspect: number): number | null;
export function primaryOf(persons: readonly PersonInfoCached[], faces: readonly { id: string; box: Rect }[], bodies: readonly { id: string; pose: Pose33 }[]): PersonId;
/** the face whose box padded by SEED_BOX_PAD contains the seed (nearest centre among several), else null */
export function seedPrimary(seed: { x: number; y: number }, faces: readonly { id: string; box: Rect }[]): string | null;
export interface HitCtx {
  faces: readonly { person: PersonId; box: Rect }[];
  /** 美體 tab only */
  bodies?: readonly { person: PersonId; mask: PersonMask | null; box: Rect }[];
  /** the current backward body field (display → source) */
  field?: BodyField | null;
  /** 44 pt in UV at the current zoom, per axis */
  minW: number;
  minH: number;
}
export function hitPerson(uv: readonly [number, number], ctx: HitCtx): PersonId | null;
```

- Produces (`src/detect/cache.ts`, appended):

```ts
export function buildCache(size: { width: number; height: number }, prepared: PreparedFaces, bodies: CachedBody[] | null, opts: { faceScans: DetectionCache['faceScans']; bodiesComplete?: boolean }): DetectionCache;
/** a 基本模式 cache gains its faces (A15): pairs link existing body persons; others are appended */
export function withFaces(cache: DetectionCache, prepared: PreparedFaces, faceScans: DetectionCache['faceScans']): DetectionCache;
/** body detection: ids by centre x (a v1 b0 keeps its id when its pose matches), pairing, body-only persons appended */
export function withBodies(cache: DetectionCache, found: BodyDetections['bodies'], faceOf: (faceId: string) => Face | null): { cache: DetectionCache; renamed: Record<PersonId, PersonId | null> };
/** old person → new person by face-box IoU ≥ 0.5, greedy (S §5.3); unmatched old → null */
export function rematchByIoU(stale: Readonly<Record<PersonId, Rect>>, cache: DetectionCache): Record<PersonId, PersonId | null>;
export function bodyBox(b: CachedBody): Rect;
```

- [x] **Step 1: Failing tests**

```ts
// src/detect/persons.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { adapt } from '../tracking/adapter111';
import type { BodyField, PersonMask, Pose33 } from '../types';
import { prepareFaces } from './faces';
import { hitPerson, pairCost, pairPersons, primaryOf, seedPrimary } from './persons';

const fx = (n: string) => JSON.parse(readFileSync(new URL(`../../tests/fixtures/${n}`, import.meta.url), 'utf8'));
const group = fx('group_faces.landmarks.json') as { width: number; height: number; faces: number[][] };
const poses = fx('group_faces.pose.json') as { poses: { points: number[] }[] };
const prepared = prepareFaces(group.faces.map((f) => ({ points: new Float32Array(f) })), group.width, group.height);
const aspect = group.width / group.height;

/** a pose whose face points sit on the face's own landmarks (a perfect pair) */
function poseOn(face: ReturnType<typeof adapt>, vis = 0.99): Pose33 {
  const P = face.pts111;
  const points = new Float32Array(33 * 4);
  const set = (i: number, k: number) => {
    points[i * 4] = P[k * 2];
    points[i * 4 + 1] = P[k * 2 + 1];
    points[i * 4 + 3] = vis;
  };
  set(0, 46);
  set(2, 105); // the pose's left eye is the image right: matched by side, not by index
  set(5, 104);
  set(9, 90);
  set(10, 84);
  for (let i = 11; i < 33; i++) {
    points[i * 4] = P[46 * 2];
    points[i * 4 + 1] = P[46 * 2 + 1] + 0.05 + i * 0.01;
    points[i * 4 + 3] = vis;
  }
  return { points };
}

describe('pairPersons (S §3.4 P4)', () => {
  it('pairs each recorded face with the pose built on it, 1:1, eyes matched by image side (B is mirrored)', () => {
    const bodies = prepared.faces.map((f, i) => ({ id: `b${i}`, pose: poseOn(f.face), mask: null }));
    expect(pairPersons(prepared.faces, bodies.slice().reverse(), aspect).sort()).toEqual(prepared.faces.map((f, i) => [f.id, `b${i}`]));
  });
  it('fewer than 3 visible points: no pair', () => {
    const f = prepared.faces[0];
    const pose = poseOn(f.face);
    for (const i of [0, 2, 5]) pose.points[i * 4 + 3] = 0.1;
    expect(pairCost(f.face, pose, aspect)).toBeNull();
  });
  it('one face and one pose whose nose lies in the face box padded by 25 % pair whatever the cost (A14)', () => {
    const f = prepared.faces[0];
    const pose = poseOn(f.face);
    // far off: four of the five points 0.5 face widths away ≈ 0.4 FW mean ≈ 0.9 IOD (pupils ≈ 0.45 FW apart): cost > 0.5
    for (const i of [2, 5, 9, 10]) pose.points[i * 4] += f.box.w * 0.5;
    expect(pairCost(f.face, pose, aspect)!).toBeGreaterThan(0.5);
    expect(pairPersons([f], [{ id: 'b0', pose, mask: null }], aspect)).toEqual([[f.id, 'b0']]);
    expect(pairPersons([f, prepared.faces[1]], [{ id: 'b0', pose, mask: null }], aspect)).toEqual([]);
  });
  it('the recorded group poses pair with A and B when MediaPipe found their bodies', () => {
    const bodies = poses.poses.map((p, i) => ({ id: `b${i}`, pose: { points: new Float32Array(p.points) }, mask: null }));
    const pairs = pairPersons(prepared.faces, bodies, aspect);
    expect(pairs.length).toBeGreaterThanOrEqual(1);
    expect(new Set(pairs.map(([f]) => f)).size).toBe(pairs.length);
  });
});

describe('primaryOf, seedPrimary', () => {
  it('the primary is A (largest × most central, selectPerson’s score)', () => {
    const persons = prepared.faces.map((f) => ({ id: f.id, face: f.id, body: null }));
    expect(primaryOf(persons, prepared.faces, [])).toBe('f0');
  });
  it('without faces the body box decides', () => {
    const body = (cx: number) => ({ points: new Float32Array(33 * 4).map((_, k) => (k % 4 === 0 ? cx + ((k / 4) % 2) * 0.1 : k % 4 === 1 ? 0.1 + (k / 4) * 0.02 : 1)) });
    expect(primaryOf([{ id: 'b0', face: null, body: 'b0' }, { id: 'b1', face: null, body: 'b1' }], [], [{ id: 'b0', pose: body(0.05) }, { id: 'b1', pose: body(0.45) }])).toBe('b1');
  });
  it('seedPrimary: padded-box containment, the nearest centre among several, null for none', () => {
    const faces = [
      { id: 'f0', box: { x: 0.1, y: 0.4, w: 0.2, h: 0.2 } },
      { id: 'f1', box: { x: 0.32, y: 0.4, w: 0.2, h: 0.2 } },
    ];
    expect(seedPrimary({ x: 0.2, y: 0.5 }, faces)).toBe('f0');
    expect(seedPrimary({ x: 0.3, y: 0.5 }, faces)).toBe('f0'); // inside both padded boxes (f1's starts at 0.27), nearer f0's centre
    expect(seedPrimary({ x: 0.34, y: 0.5 }, faces)).toBe('f1'); // inside both, nearer f1's centre
    expect(seedPrimary({ x: 0.9, y: 0.1 }, faces)).toBeNull();
  });
});

describe('hitPerson (S §2.3)', () => {
  const ctx = {
    faces: [
      { person: 'f0', box: { x: 0.1, y: 0.3, w: 0.2, h: 0.2 } },
      { person: 'f1', box: { x: 0.5, y: 0.3, w: 0.02, h: 0.02 } },
    ],
    minW: 0.1,
    minH: 0.1,
  };
  it('faces first: the padded box, expanded to 44 pt at this zoom', () => {
    expect(hitPerson([0.2, 0.4], ctx)).toBe('f0');
    expect(hitPerson([0.54, 0.31], ctx)).toBe('f1'); // a tiny face is hit within its 44 pt
    expect(hitPerson([0.54, 0.31], { ...ctx, minW: 0.01, minH: 0.01 })).toBeNull(); // zoomed in 10×
  });
  it('maps display → source through the body field first', () => {
    const d = Math.fround(0.3);
    const field: BodyField = { width: 2, height: 2, data: new Float32Array([d, 0, d, 0, d, 0, d, 0]), version: 1 };
    expect(hitPerson([-0.1 + 0.001, 0.4], { ...ctx, field })).toBe('f0');
  });
  it('bodies (美體 only, when no face was hit): the highest mask value, equal values → the smaller mask', () => {
    const full = (v: number): PersonMask => ({ width: 4, height: 4, data: new Uint8Array(16).fill(v) });
    const half: PersonMask = { width: 4, height: 4, data: new Uint8Array(16).map((_, i) => (i % 4 < 2 ? 200 : 0)) };
    const bodies = [
      { person: 'b0', mask: full(200), box: { x: 0, y: 0, w: 1, h: 1 } },
      { person: 'b1', mask: half, box: { x: 0, y: 0, w: 0.5, h: 1 } },
    ];
    expect(hitPerson([0.1, 0.9], { ...ctx, bodies })).toBe('b1');
    expect(hitPerson([0.9, 0.9], { ...ctx, bodies })).toBe('b0');
    expect(hitPerson([0.9, 0.9], { ...ctx, bodies: [{ person: 'b2', mask: null, box: { x: 0.8, y: 0.8, w: 0.15, h: 0.15 } }] })).toBe('b2');
  });
});
```

Append to `src/detect/cache.test.ts` (add `buildCache, rematchByIoU, withBodies, withFaces` to the import, plus `import { EMPTY_PREPARED, prepareFaces } from './faces';`, `import { readFileSync } from 'node:fs';`, `import type { Face, Landmarks478, Pose33 } from '../types';`, and copy verbatim from `faces.test.ts` (Task 13 Step 3) its `fx`, `sample` and `lmAt` helpers — `lmAt` reads the recorded `landmarks_sample_face.json` through them):

```ts
describe('building the cache (S §3.3, §5.3)', () => {
  const size = { width: 1000, height: 1000 };
  const two = prepareFaces([lmAt(0.3, 0.4, 0.2), lmAt(0.7, 0.4, 0.2)], 1000, 1000);
  const scans = [{ quarter: 0 as const, flipH: false }];
  it('faces become persons left to right with their face ids; nobody → the p0 form', () => {
    const c = buildCache(size, two, null, { faceScans: scans });
    expect(c.persons).toEqual([{ id: 'f0', face: 'f0', body: null }, { id: 'f1', face: 'f1', body: null }]);
    expect(c.bodies).toBeNull();
    expect(buildCache(size, EMPTY_PREPARED, null, { faceScans: scans }).persons).toEqual([{ id: 'p0', face: null, body: null }]);
  });
  it('withBodies: ids by centre x, pairs link face persons (ids unchanged), body-only persons are appended', () => {
    const c = buildCache(size, two, null, { faceScans: scans });
    const faceOf = (id: string) => two.faces.find((f) => f.id === id)!.face;
    const onF1 = { pose: poseOnFace(two.faces[1].face), mask: null, score: 0.2 };
    const lone = { pose: cacheBody('x', 0.95).pose, mask: null, score: 0.1 };
    const r = withBodies(c, [lone, onF1], faceOf);
    expect(r.cache.bodies!.map((b) => b.id)).toEqual(['b0', 'b1']);
    expect(r.cache.persons).toEqual([
      { id: 'f0', face: 'f0', body: null },
      { id: 'f1', face: 'f1', body: 'b0' },
      { id: 'b1', face: null, body: 'b1' },
    ]);
    expect(r.cache.primary).toBe(c.primary);
  });
  it('withBodies on the no-face cache drops p0; the primary is the best body', () => {
    const r = withBodies(buildCache(size, EMPTY_PREPARED, null, { faceScans: scans }), [{ pose: cacheBody('x', 0.5).pose, mask: null, score: 0.3 }], () => null);
    expect(r.cache.persons).toEqual([{ id: 'b0', face: null, body: 'b0' }]);
    expect(r.cache.primary).toBe('b0');
  });
  it('withFaces merges faces into a 基本模式 cache and keeps the body persons and their ids (A15)', () => {
    const basic = withBodies(buildCache(size, EMPTY_PREPARED, null, { faceScans: [] }), [{ pose: poseOnFace(two.faces[0].face), mask: null, score: 0.3 }], () => null).cache;
    const merged = withFaces(basic, two, scans);
    expect(merged.persons).toEqual([{ id: 'b0', face: 'f0', body: 'b0' }, { id: 'f1', face: 'f1', body: null }]);
    expect(merged.faceScans).toEqual(scans);
  });
  it('rematchByIoU maps old persons to the new ones by face box (≥ 0.5), the rest to null', () => {
    const c = buildCache(size, two, null, { faceScans: scans });
    const map = rematchByIoU({ old1: two.faces[1].box, old9: { x: 0.9, y: 0.9, w: 0.05, h: 0.05 } }, c);
    expect(map).toEqual({ old1: 'f1', old9: null });
  });
});
```

with, in the same file, `function poseOnFace(face: Face): Pose33` identical to `poseOn` of `persons.test.ts` (copy it; add `cacheBody` to the `./testCaches` import).

Run: `npx vitest run src/detect`
Expected: FAIL (cannot resolve `./persons`; `buildCache` not exported).

- [x] **Step 2: Write `src/detect/persons.ts`**

```ts
// Persons from faces and bodies (S §3.4 P4, §2.3): pairing, the primary, the camera seed and the photo hit test.
// Pure and resolution-free (normalized O-space; iso distances divide y by the aspect).
import { fieldAt } from '../body/cpuWarp';
import { SEED_BOX_PAD } from '../config/limits';
import { maskCoversFace } from '../ui/faceProtectModel';
import type { BodyField, Face, PersonId, PersonInfoCached, PersonMask, Pose33, Rect } from '../types';
import { boxScore, poseBox } from './cache';

export interface PairFace {
  id: string;
  face: Face;
  box: Rect;
}
export interface PairBody {
  id: string;
  pose: Pose33;
  mask: PersonMask | null;
}

type V2 = [number, number];
const pad = (b: Rect, f: number): Rect => ({ x: b.x - b.w * f, y: b.y - b.h * f, w: b.w * (1 + 2 * f), h: b.h * (1 + 2 * f) });
const inside = (b: Rect, p: readonly [number, number]) => p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h;
const VIS = 0.5;

/**
 * Mean iso distance between the pose's nose / eyes / mouth corners (0, 2, 5, 9, 10) and the face's nose tip, pupils
 * and mouth corners (pts111 46, 104, 105, 84, 90), over the visible pose points, divided by the face's inter-ocular
 * distance. Eyes and mouth corners are matched by image side (left-most with left-most), so the two models' person-left
 * / image-right conventions cannot cross. null: fewer than 3 visible points (a back view) or a degenerate face.
 */
export function pairCost(face: Face, pose: Pose33, aspect: number): number | null {
  const P = face.pts111;
  const fp = (k: number): V2 => [P[k * 2], P[k * 2 + 1]];
  const pp = (i: number): V2 => [pose.points[i * 4], pose.points[i * 4 + 1]];
  const vis = (i: number) => pose.points[i * 4 + 3] >= VIS;
  const iso = (a: V2, b: V2) => Math.hypot(a[0] - b[0], (a[1] - b[1]) / aspect);
  const iod = iso(fp(104), fp(105));
  if (!(iod > 1e-6)) return null;
  const pairs: [V2, V2][] = [];
  if (vis(0)) pairs.push([pp(0), fp(46)]);
  const bySide = (a: number, b: number, fa: number, fb: number) => {
    const [pl, pr] = pp(a)[0] <= pp(b)[0] ? [a, b] : [b, a];
    const [fl, fr] = fp(fa)[0] <= fp(fb)[0] ? [fa, fb] : [fb, fa];
    if (vis(pl)) pairs.push([pp(pl), fp(fl)]);
    if (vis(pr)) pairs.push([pp(pr), fp(fr)]);
  };
  bySide(2, 5, 104, 105);
  bySide(9, 10, 84, 90);
  if (pairs.length < 3) return null;
  return pairs.reduce((s, [a, b]) => s + iso(a, b), 0) / pairs.length / iod;
}

export function pairPersons(faces: readonly PairFace[], bodies: readonly PairBody[], aspect: number): [string, string][] {
  const nose = (b: PairBody): V2 | null => (b.pose.points[3] >= VIS ? [b.pose.points[0], b.pose.points[1]] : null);
  // A14: one face and one pose whose visible nose lies in the face box padded by 25 % always pair
  if (faces.length === 1 && bodies.length === 1) {
    const n = nose(bodies[0]);
    if (n && inside(pad(faces[0].box, 0.25), n)) return [[faces[0].id, bodies[0].id]];
  }
  const cand: { f: string; b: string; cost: number }[] = [];
  for (const f of faces) {
    for (const b of bodies) {
      const cost = pairCost(f.face, b.pose, aspect);
      if (cost === null || cost > 0.5) continue;
      const n = nose(b);
      if (n && !inside(pad(f.box, 0.1), n)) continue;
      if (b.mask && !maskCoversFace(f.face, b.mask)) continue;
      cand.push({ f: f.id, b: b.id, cost });
    }
  }
  cand.sort((a, b) => a.cost - b.cost);
  const usedF = new Set<string>();
  const usedB = new Set<string>();
  const out: [string, string][] = [];
  for (const c of cand) {
    if (usedF.has(c.f) || usedB.has(c.b)) continue;
    usedF.add(c.f);
    usedB.add(c.b);
    out.push([c.f, c.b]);
  }
  return out;
}

/** the face box area × centrality (selectPerson's score); without faces, the body box (RM §3.6) */
export function primaryOf(
  persons: readonly PersonInfoCached[],
  faces: readonly { id: string; box: Rect }[],
  bodies: readonly { id: string; pose: Pose33 }[],
): PersonId {
  let best: PersonId | null = null;
  let bestScore = -Infinity;
  const consider = (id: PersonId, s: number) => {
    if (s > bestScore) {
      bestScore = s;
      best = id;
    }
  };
  for (const p of persons) {
    const f = p.face ? faces.find((x) => x.id === p.face) : undefined;
    if (f) consider(p.id, boxScore(f.box));
  }
  if (best === null) {
    for (const p of persons) {
      const b = p.body ? bodies.find((x) => x.id === p.body) : undefined;
      if (b) consider(p.id, boxScore(poseBox(b.pose.points)));
    }
  }
  return best ?? persons[0]?.id ?? 'p0';
}

export function seedPrimary(seed: { x: number; y: number }, faces: readonly { id: string; box: Rect }[]): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const f of faces) {
    if (!inside(pad(f.box, SEED_BOX_PAD), [seed.x, seed.y])) continue;
    const d = Math.hypot(f.box.x + f.box.w / 2 - seed.x, f.box.y + f.box.h / 2 - seed.y);
    if (d < bestD) {
      bestD = d;
      best = f.id;
    }
  }
  return best;
}

export interface HitCtx {
  faces: readonly { person: PersonId; box: Rect }[];
  bodies?: readonly { person: PersonId; mask: PersonMask | null; box: Rect }[];
  field?: BodyField | null;
  minW: number;
  minH: number;
}

/** bilinear-free nearest sample of a mask at UV (0..255), 0 outside */
function maskAtUv(m: PersonMask, u: number, v: number): number {
  if (u < 0 || v < 0 || u >= 1 || v >= 1) return 0;
  return m.data[Math.min(m.height - 1, Math.floor(v * m.height)) * m.width + Math.min(m.width - 1, Math.floor(u * m.width))];
}

export function hitPerson(uv: readonly [number, number], ctx: HitCtx): PersonId | null {
  // 1. display → source through the backward map without the face chains (the body field: reshape.ts:290)
  const d = ctx.field ? fieldAt(ctx.field, uv[0], uv[1]) : [0, 0];
  const src: [number, number] = [uv[0] + d[0], uv[1] + d[1]];
  // 2. faces: padded 15 % as drawn, then grown to at least 44 pt; the smallest normalized centre distance wins
  let face: PersonId | null = null;
  let best = Infinity;
  for (const f of ctx.faces) {
    const p = pad(f.box, 0.15);
    const w = Math.max(p.w, ctx.minW);
    const h = Math.max(p.h, ctx.minH);
    const box = { x: p.x + p.w / 2 - w / 2, y: p.y + p.h / 2 - h / 2, w, h };
    if (!inside(box, src)) continue;
    const score = Math.abs(src[0] - (box.x + w / 2)) / w + Math.abs(src[1] - (box.y + h / 2)) / h;
    if (score < best) {
      best = score;
      face = f.person;
    }
  }
  if (face !== null || !ctx.bodies?.length) return face;
  // 3. bodies: the highest mask value ≥ 128 wins, equal values → the smaller mask; without masks the pose boxes
  let body: PersonId | null = null;
  let bestV = 127;
  let bestArea = Infinity;
  for (const b of ctx.bodies) {
    if (b.mask) {
      const v = maskAtUv(b.mask, src[0], src[1]);
      const area = b.mask.data.reduce((n, x) => n + (x >= 128 ? 1 : 0), 0) / (b.mask.width * b.mask.height);
      if (v > bestV || (v === bestV && v >= 128 && area < bestArea)) {
        bestV = v;
        bestArea = area;
        body = b.person;
      }
    } else if (inside(pad(b.box, 0.05), src)) {
      const area = b.box.w * b.box.h;
      if (bestV < 128 && area < bestArea) {
        bestArea = area;
        body = b.person;
      }
    }
  }
  return body;
}
```

- [x] **Step 3: Append the builders to `src/detect/cache.ts`**

(Add imports: `import type { PreparedFaces } from './faces';` (type-only, no cycle at run time), `import { boxIoU } from './faces';`, `import { pairPersons, primaryOf } from './persons';`, and `BodyDetections, Face` types.)

```ts
const centreX = (b: Rect) => b.x + b.w / 2;
const centreY = (b: Rect) => b.y + b.h / 2;
const byPosition = (a: Rect, b: Rect) => (Math.abs(centreX(a) - centreX(b)) > 0.01 ? centreX(a) - centreX(b) : centreY(a) - centreY(b));

export function bodyBox(b: CachedBody): Rect {
  return poseBox(b.pose.points);
}

/** The first cache of a photo: persons left to right by face box (body box for a body-only person), S §2.1 numbering. */
export function buildCache(
  size: { width: number; height: number },
  prepared: PreparedFaces,
  bodies: CachedBody[] | null,
  opts: { faceScans: DetectionCache['faceScans']; bodiesComplete?: boolean },
): DetectionCache {
  const faces: CachedFace[] = prepared.faces.map((f) => ({ id: f.id, lm: f.lm, box: f.box }));
  if (!faces.length && !bodies?.length) {
    return { ...noFaceCache(size.width, size.height, opts.faceScans), bodies, obstacles: prepared.obstacles, dropped: prepared.dropped };
  }
  const aspect = size.width / size.height;
  const pairs = bodies ? pairPersons(prepared.faces, bodies, aspect) : [];
  const bodyOf = new Map(pairs);
  const paired = new Set(pairs.map(([, b]) => b));
  const entries: { info: PersonInfoCached; box: Rect }[] = [
    ...prepared.faces.map((f) => ({ info: { id: f.id, face: f.id, body: bodyOf.get(f.id) ?? null }, box: f.box })),
    ...(bodies ?? []).filter((b) => !paired.has(b.id)).map((b) => ({ info: { id: b.id, face: null, body: b.id }, box: bodyBox(b) })),
  ];
  entries.sort((a, b) => byPosition(a.box, b.box));
  const persons = entries.map((e) => e.info);
  return {
    v: 1,
    width: size.width,
    height: size.height,
    faceScans: opts.faceScans,
    faces,
    obstacles: prepared.obstacles,
    bodies,
    bodiesComplete: opts.bodiesComplete ?? true,
    persons,
    primary: primaryOf(persons, faces, bodies ?? []),
    dropped: prepared.dropped,
  };
}

/** A 基本模式 cache gains its faces once a tracker exists (A15): a face that pairs with a body person links to it (the
 * person keeps its id and params); the other faces are appended. The primary is kept unless it was p0. */
export function withFaces(cache: DetectionCache, prepared: PreparedFaces, faceScans: DetectionCache['faceScans']): DetectionCache {
  if (!cache.bodies?.length) {
    const fresh = buildCache({ width: cache.width, height: cache.height }, prepared, cache.bodies, { faceScans, bodiesComplete: cache.bodiesComplete });
    return fresh;
  }
  const pairs = pairPersons(prepared.faces, cache.bodies, cache.width / cache.height);
  const faceOfBody = new Map(pairs.map(([f, b]) => [b, f]));
  const persons: PersonInfoCached[] = cache.persons.map((p) => (p.body && faceOfBody.has(p.body) ? { ...p, face: faceOfBody.get(p.body)! } : p));
  const linked = new Set(persons.map((p) => p.face).filter((x): x is string => x !== null));
  for (const f of prepared.faces) if (!linked.has(f.id)) persons.push({ id: f.id, face: f.id, body: null });
  const faces = prepared.faces.map((f) => ({ id: f.id, lm: f.lm, box: f.box }));
  return { ...cache, faceScans, faces, obstacles: prepared.obstacles, persons, dropped: prepared.dropped, primary: cache.primary === 'p0' ? primaryOf(persons, faces, cache.bodies) : cache.primary };
}

/** mean distance of the keypoints visible in both poses (v1 b0 rematch, S §5.3) */
function poseDistance(a: Pose33, b: Pose33): number {
  let s = 0;
  let n = 0;
  for (let i = 0; i < 33; i++) {
    if (a.points[i * 4 + 3] < 0.5 || b.points[i * 4 + 3] < 0.5) continue;
    s += Math.hypot(a.points[i * 4] - b.points[i * 4], a.points[i * 4 + 1] - b.points[i * 4 + 1]);
    n++;
  }
  return n ? s / n : Infinity;
}

export function withBodies(
  cache: DetectionCache,
  found: BodyDetections['bodies'],
  faceOf: (faceId: string) => Face | null,
): { cache: DetectionCache; renamed: Record<PersonId, PersonId | null> } {
  const renamed: Record<PersonId, PersonId | null> = {};
  // ids: a v1 b0 (bodiesComplete false) keeps its id when its pose matches; the others get the lowest free b<j> by x
  const old = cache.bodies ?? [];
  const sorted = [...found].sort((a, b) => byPosition(poseBox(a.pose.points), poseBox(b.pose.points)));
  const ids = new Map<(typeof found)[number], string>();
  for (const o of old) {
    let bestI = -1;
    let bestD = 0.05;
    sorted.forEach((b, i) => {
      if (ids.has(b)) return;
      const d = poseDistance(o.pose, b.pose);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    });
    if (bestI >= 0) ids.set(sorted[bestI], o.id);
  }
  const used = new Set(ids.values());
  for (const b of sorted) {
    if (ids.has(b)) continue;
    let j = 0;
    while (used.has(`b${j}`)) j++;
    used.add(`b${j}`);
    ids.set(b, `b${j}`);
  }
  const bodies: CachedBody[] = sorted.map((b) => ({ id: ids.get(b)!, pose: b.pose, mask: b.mask, score: b.score }));
  // persons: links to bodies that vanished are dropped; a body-only person whose body vanished hands over (renamed)
  const alive = new Set(bodies.map((b) => b.id));
  let persons: PersonInfoCached[] = [];
  for (const p of cache.persons) {
    if (p.id === 'p0') continue;
    if (p.body && !alive.has(p.body)) {
      if (p.face) persons.push({ ...p, body: null });
      else renamed[p.id] = null;
    } else persons.push(p);
  }
  // pair the faces without a body with the bodies without a person
  const linkedBodies = new Set(persons.map((p) => p.body).filter((x): x is string => x !== null));
  const freeFaces = persons
    .filter((p) => p.face && !p.body)
    .map((p) => {
      const c = cache.faces.find((f) => f.id === p.face)!;
      const face = faceOf(c.id);
      return face ? { id: c.id, face, box: c.box } : null;
    })
    .filter((x): x is { id: string; face: Face; box: Rect } => x !== null);
  const freeBodies = bodies.filter((b) => !linkedBodies.has(b.id));
  for (const [f, b] of pairPersons(freeFaces, freeBodies, cache.width / cache.height)) {
    persons = persons.map((p) => (p.face === f ? { ...p, body: b } : p));
    linkedBodies.add(b);
  }
  for (const b of bodies) if (!linkedBodies.has(b.id)) persons.push({ id: b.id, face: null, body: b.id });
  const primary = cache.primary === 'p0' || !persons.some((p) => p.id === cache.primary) ? primaryOf(persons, cache.faces, bodies) : cache.primary;
  for (const [from, to] of Object.entries(renamed)) if (to === null && from === cache.primary) renamed[from] = primary;
  return { cache: { ...cache, bodies, bodiesComplete: true, persons, primary }, renamed };
}

export function rematchByIoU(stale: Readonly<Record<PersonId, Rect>>, cache: DetectionCache): Record<PersonId, PersonId | null> {
  const cands: { from: PersonId; to: PersonId; iou: number }[] = [];
  for (const [from, box] of Object.entries(stale)) {
    for (const p of cache.persons) {
      const f = p.face ? cache.faces.find((x) => x.id === p.face) : undefined;
      if (!f) continue;
      const iou = boxIoU(box, f.box);
      if (iou >= 0.5) cands.push({ from, to: p.id, iou });
    }
  }
  cands.sort((a, b) => b.iou - a.iou);
  const out: Record<PersonId, PersonId | null> = {};
  const usedTo = new Set<PersonId>();
  for (const c of cands) {
    if (c.from in out || usedTo.has(c.to)) continue;
    out[c.from] = c.to;
    usedTo.add(c.to);
  }
  for (const from of Object.keys(stale)) if (!(from in out)) out[from] = null;
  return out;
}
```

Note the v1 people ≥ 2 case of S §5.3 falls out of these rules: the old `b0` keeps its id when matched (its person keeps its params); when unmatched, a face person loses only the link, and a body-only person is renamed to the new primary (`renamed[b0] = primary`) so its params move there (Task 21 applies `renamed` through `renamePersons` before `assignPersons`).

- [x] **Step 4: Run**

Run: `npx vitest run src/detect && npm run typecheck`
Expected: PASS; `tsc` exits 0.

- [x] **Step 5: Commit**

```bash
git add src/detect/persons.ts src/detect/persons.test.ts src/detect/cache.ts src/detect/cache.test.ts
git commit -m "v0.4 step 1c: persons (pairing, primary, seed, hit test) and the cache builders"
```

---

### Task 16: Caps, the face-table layout and the N-face CPU port

**Files:**
- Modify: `src/engine/passes/faceCap.ts` (append), `src/engine/passes/reshapeCpu.ts` (rewrite), `src/engine/passes/reshapeCpu.test.ts` (append), `src/types.ts` (FaceProtect.window, CRLF)
- Create: `src/engine/passes/faceTable.ts` (the layout constant, a leaf module: `reshape.ts` reads it at load time in Task 17), `src/engine/passes/reshapeCpuV03.ts` (frozen copy), `src/engine/passes/faceCap.test.ts`

**Interfaces:**
- Consumes: `reshapeGeometry`, `faceWidthIso`, `yawAttenuation`, `RESHAPE_SCALE`, `EMPTY_BOX`, `PROTECT_*`, `SLIM`, `V_JAW`, `NARROW`, `NOSE` (`reshape.ts`), `fieldAt`, `MIN_DET` (`body/field.ts:70`), `MAX_RENDER_FACES`.
- Produces (`faceCap.ts`):

```ts
export const FT = { ROW: 96, PTS: 0, EXT: 56, VT: 60, NT: 63, CHIN_EYE: 65, S1: 66, S2: 67, RADII: 68, PROT: 69, RIGHT: 70, BOX: 72, CAP: 73, WIN: 74 } as const;
export const WHOLE: Rect;                     // {x: 0, y: 0, w: 1, h: 1}
export interface TableFace {
  face: Face;
  /** what the shader applies: × weight and yaw-attenuated (attenuate() below) */
  u: ReshapeUniforms;
  /** protect layer, −1 = none */
  layer: number;
  /** the UV rect the layer covers (WHOLE for the photo grid) */
  window: Rect;
  /** oval-bbox centre (UV) */
  centre: [number, number];
  /** iso; −1 = no cap */
  cap: number;
}
export function attenuate(u: ReshapeUniforms, yaw: number): ReshapeUniforms;
export function faceDrawn(u: ReshapeUniforms): boolean;   // any non-zero (reshape.ts:363-365)
export function capsFor(centres: readonly (readonly [number, number])[], obstacles: readonly (readonly [number, number])[], aspect: number, presence?: readonly number[]): number[];
export function capBox(centre: readonly [number, number], cap: number, aspect: number): [number, number, number, number];
export function influenceBox(t: TableFace, aspect: number): [number, number, number, number];   // EMPTY_BOX when not drawn or clipped away
export function uMaxBox(face: Face, aspect: number): [number, number, number, number];
export function packFaceTable(faces: readonly TableFace[], aspect: number, out: Float32Array): void;
```

- Produces (`reshapeCpu.ts`): `reshapeMapMulti(faces: readonly TableFace[], aspect: number, opts?: { body?: BodyField | null; protects?: readonly FaceProtect[] }): UvMap`; `reshapeMapCpu(face, uIn, aspect, body?, protect?)` kept as the one-face wrapper; `protectAt(p, u, v)` unchanged. `FaceProtect` gains `window?: Rect` (types.ts) — the UV rect its grid covers (absent = whole photo).

- [x] **Step 1: Freeze today's port**

Run: `cp src/engine/passes/reshapeCpu.ts src/engine/passes/reshapeCpuV03.ts`
Then edit the copy: first line becomes `// FROZEN v0.3 copy of reshapeCpu.ts (test-only anchor for the bit-exact single-face check of the N-face port). Never edit.`, and rename its exports `reshapeMapCpu` → `reshapeMapCpuV03`, `protectAt` → `protectAtV03`.

- [x] **Step 2: Failing tests**

```ts
// src/engine/passes/faceCap.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { adapt } from '../../tracking/adapter111';
import { applyPreset, setParam } from '../params';
import { EMPTY_BOX, reshapeGeometry, reshapeUniforms } from './reshape';
import { attenuate, capBox, capsFor, FT, influenceBox, ovalBox, boxCentre, packFaceTable, uMaxBox, WHOLE } from './faceCap';

const lm = JSON.parse(readFileSync(new URL('../../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8'));
const face = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);
const aspect = lm.width / lm.height;
const max = reshapeUniforms(['shape.faceSlim', 'shape.eyeEnlarge'].reduce((p, id) => setParam(p, id as never, 1), applyPreset('original', 1)).values, 1);

describe('capsFor (S §4.1)', () => {
  it('half the iso distance to the nearest other face or obstacle; −1 without a neighbour', () => {
    expect(capsFor([[0.5, 0.5]], [], 1)).toEqual([-1]);
    // (0.6 − 0.2 is 0.39999999999999997 in doubles: compare closely, never exactly)
    const two = capsFor([[0.2, 0.5], [0.6, 0.5]], [], 1);
    expect(two).toHaveLength(2);
    for (const c of two) expect(c).toBeCloseTo(0.2, 12);
    expect(capsFor([[0.2, 0.5]], [[0.3, 0.5]], 1)[0]).toBeCloseTo(0.05);
  });
  it('presence divides a neighbour’s distance; presence 0 ignores it', () => {
    expect(capsFor([[0.2, 0.5], [0.6, 0.5]], [], 1, [1, 0.5])[0]).toBeCloseTo(0.4);
    expect(capsFor([[0.2, 0.5], [0.6, 0.5]], [], 1, [1, 0])[0]).toBe(-1);
  });
  it('iso units: a 3:1 panorama and a 1:3 screenshot (Review Focus #3)', () => {
    expect(capsFor([[0.1, 0.5], [0.2, 0.5]], [], 3)[0]).toBeCloseTo(0.05);
    expect(capsFor([[0.5, 0.1], [0.5, 0.4]], [], 3)[0]).toBeCloseTo(0.05); // dy 0.3 UV = 0.1 iso
    expect(capsFor([[0.5, 0.1], [0.5, 0.4]], [], 1 / 3)[0]).toBeCloseTo(0.45);
    // the iso disc of radius 0.1 is 0.1 wide in u and 0.1 · 3 tall in v
    const b = capBox([0.05, 0.5], 0.1, 3);
    [0.05 - 0.1, 0.5 - 0.3, 0.05 + 0.1, 0.5 + 0.3].forEach((want, i) => expect(b[i]).toBeCloseTo(want, 12));
  });
});

describe('face table packing (S §4.4)', () => {
  const t = { face, u: attenuate(max, face.yaw), layer: 0, window: WHOLE, centre: boxCentre(ovalBox(face)), cap: -1 };
  it('rows of 96 texels: pts111, ext, targets, strengths, radii, protect, box, cap, window', () => {
    const out = new Float32Array(FT.ROW * 4 * 2);
    packFaceTable([t, { ...t, u: reshapeUniforms(applyPreset('original', 1).values, 1), cap: 0.1 }], aspect, out);
    expect(Array.from(out.subarray(0, 222))).toEqual(Array.from(face.pts111));
    expect(Array.from(out.subarray(FT.EXT * 4, FT.EXT * 4 + 16))).toEqual(Array.from(face.ext));
    const g = reshapeGeometry(face, aspect, t.u);
    expect(out[FT.S1 * 4]).toBe(Math.fround(t.u.faceSlim));
    expect(out[FT.S2 * 4 + 3]).toBe(Math.fround(t.u.eyeEnlarge));
    expect(out[FT.RADII * 4 + 3]).toBe(0);
    expect(Array.from(out.subarray(FT.BOX * 4, FT.BOX * 4 + 4))).toEqual(g.box.map(Math.fround));
    expect(out[FT.CAP * 4 + 2]).toBe(-1);
    expect(Array.from(out.subarray(FT.WIN * 4, FT.WIN * 4 + 4))).toEqual([0, 0, 1, 1]);
    const row = FT.ROW * 4;
    expect(Array.from(out.subarray(row + FT.BOX * 4, row + FT.BOX * 4 + 4))).toEqual(EMPTY_BOX.map(Math.fround)); // not drawn
    expect(out[row + FT.CAP * 4 + 2]).toBe(Math.fround(0.1));
  });
  it('a capped face’s influence box is clipped to its cap disc; uMaxBox covers every item at its maximum', () => {
    const capped = influenceBox({ ...t, cap: 0.02 }, aspect);
    const c = t.centre;
    expect(capped[0]).toBeGreaterThanOrEqual(c[0] - 0.02 - 1e-9);
    expect(capped[2]).toBeLessThanOrEqual(c[0] + 0.02 + 1e-9);
    const um = uMaxBox(face, aspect);
    const g = reshapeGeometry(face, aspect, t.u).box;
    expect(um[0]).toBeLessThanOrEqual(g[0]);
    expect(um[3]).toBeGreaterThanOrEqual(g[3]);
  });
});
```

Add these imports at the top of `src/engine/passes/reshapeCpu.test.ts` (merge `reshapeMapMulti` into its existing `./reshapeCpu` import and `Face` into its `../../types` type import; `ReshapeUniforms` lives in `./reshape`, not in `types.ts`):

```ts
import { reshapeMapCpuV03 } from './reshapeCpuV03';
import { reshapeMapCpu, reshapeMapMulti } from './reshapeCpu';
import { attenuate, boxCentre, capsFor, ovalBox, WHOLE, type TableFace } from './faceCap';
import type { ReshapeUniforms as RU } from './reshape';
import { MIN_DET } from '../../body/field';
import { syntheticPortrait } from '../../body/synthetic';
import { buildFaceProtect } from '../../tracking/faceProtect';
import type { Face, ParamId } from '../../types';
```

and append:

```ts
/** the fixture face rescaled to face width `fw` (iso) at centre (cx, cy) on an aspect-1 image, with `yaw` */
function placed(cx: number, cy: number, fw: number, yaw = 0): Face {
  const iso = (a: Float32Array) => {
    const out = new Float32Array(a.length);
    const b = ovalBox(face);
    const c = [b.x + b.w / 2, (b.y + b.h / 2) / aspect];
    const k = fw / Math.hypot(face.pts111[0] - face.pts111[64], (face.pts111[1] - face.pts111[65]) / aspect);
    for (let i = 0; i < a.length; i += 2) {
      out[i] = cx + (a[i] - c[0]) * k;
      out[i + 1] = cy + (a[i + 1] / aspect - c[1]) * k;
    }
    return out;
  };
  return { pts111: iso(face.pts111), ext: iso(face.ext), oval: iso(face.oval), yaw };
}

function minDet(map: (x: number, y: number) => [number, number], box: [number, number, number, number], n = 41): number {
  let min = Infinity;
  const hx = (box[2] - box[0]) / (n - 1);
  const hy = (box[3] - box[1]) / (n - 1);
  for (let j = 0; j + 1 < n; j++)
    for (let i = 0; i + 1 < n; i++) {
      const x = box[0] + i * hx;
      const y = box[1] + j * hy;
      const a = map(x, y);
      const bx = map(x + hx, y);
      const by = map(x, y + hy);
      if (![...a, ...bx, ...by].every(Number.isFinite)) return -Infinity;
      min = Math.min(min, ((bx[0] - a[0]) / hx) * ((by[1] - a[1]) / hy) - ((bx[1] - a[1]) / hx) * ((by[0] - a[0]) / hy));
    }
  return min;
}

const tf = (f: Face, u: RU, extra: Partial<TableFace> = {}): TableFace => ({ face: f, u: attenuate(u, f.yaw), layer: -1, window: WHOLE, centre: boxCentre(ovalBox(f)), cap: -1, ...extra });

describe('N-face port (S §4.4)', () => {
  it('one face is bit-exact with the frozen v0.3 port, with and without the limit and the body field', () => {
    const pr = syntheticPortrait();
    const prot = buildFaceProtect(pr.face, null, pr.width, pr.height);
    const d = Math.fround(0.01);
    const body = { width: 2, height: 2, data: new Float32Array([d, 0, d, 0, d, 0, d, 0]), version: 1 };
    for (const ids of [['shape.faceSlim', 'shape.faceV'], ['shape.chin', 'shape.eyeEnlarge', 'shape.mouthSize', 'shape.eyeDistance']] as const) {
      const u = reshapeUniforms(params(ids as unknown as ParamId[]), 1);
      for (const [f, a, p, b] of [
        [face, aspect, null, null],
        [pr.face, pr.width / pr.height, prot, null],
        [face, aspect, null, body],
      ] as const) {
        const now = reshapeMapCpu(f, u, a, b, p);
        const then = reshapeMapCpuV03(f, u, a, b, p);
        for (let y = 0.02; y < 1; y += 0.024) for (let x = 0.02; x < 1; x += 0.024) expect(now(x, y)).toEqual(then(x, y));
      }
    }
  });
  it('two faces: the sum of each face alone with its cap (obstacle at the other centre)', () => {
    const u = reshapeUniforms(params(['shape.faceSlim', 'shape.faceV', 'shape.eyeEnlarge']), 1);
    const A = placed(0.3, 0.5, 0.12);
    const B = placed(0.48, 0.5, 0.12);
    const cap = Math.hypot(0.18, 0) / 2;
    const both = reshapeMapMulti([tf(A, u, { cap }), tf(B, u, { cap })], 1);
    const a = reshapeMapMulti([tf(A, u, { cap })], 1);
    const b = reshapeMapMulti([tf(B, u, { cap })], 1);
    for (let y = 0.3; y < 0.7; y += 0.013)
      for (let x = 0.15; x < 0.65; x += 0.013) {
        const s = both(x, y);
        const ea = a(x, y);
        const eb = b(x, y);
        expect(s[0]).toBeCloseTo(ea[0] + eb[0] - x, 12);
        expect(s[1]).toBeCloseTo(ea[1] + eb[1] - y, 12);
      }
  });
  it('fold and strength sweep: min det J ≥ MIN_DET; eyes / nose / mouth keep ≥ 0.9 at ≥ 1.2 FW', () => {
    const FW = 0.12;
    const oneWay: ParamId[] = ['shape.eyeEnlarge', 'shape.faceSlim', 'shape.faceV', 'shape.faceNarrow', 'shape.noseSlim'];
    const bi: ParamId[] = ['shape.chin', 'shape.forehead', 'shape.mouthSize', 'shape.eyeDistance'];
    const settings = [0, 1].map((end) => reshapeUniforms(bi.reduce((p, id) => setParam(p, id, end), oneWay.reduce((p, id) => setParam(p, id, 1), applyPreset('original', 1))).values, 1));
    const featureMean = (map: (x: number, y: number) => [number, number], f: Face) => {
      const P = f.pts111;
      let s = 0;
      for (const k of [72, 73, 75, 76, 46, 47, 98, 102]) s += Math.hypot(...(map(P[k * 2], P[k * 2 + 1]).map((v, i) => v - P[k * 2 + i]) as [number, number]));
      return s / 8;
    };
    let worst = Infinity;
    for (const u of settings)
      for (const yaw of [0, 0.3])
        for (const deg of [0, 45, 90])
          for (const count of [2, 3])
            for (let dFW = 0.6; dFW <= 2.6001; dFW += 0.1) {
              const dx = Math.cos((deg * Math.PI) / 180) * dFW * FW;
              const dy = Math.sin((deg * Math.PI) / 180) * dFW * FW;
              const faces = Array.from({ length: count }, (_, i) => placed(0.5 + (i - (count - 1) / 2) * dx, 0.5 + (i - (count - 1) / 2) * dy, FW, yaw));
              const centres = faces.map((f) => boxCentre(ovalBox(f)));
              const caps = capsFor(centres, [], 1);
              const map = reshapeMapMulti(faces.map((f, i) => tf(f, u, { cap: caps[i] })), 1);
              const box: [number, number, number, number] = [0.5 - (count * dFW * FW) / 2 - FW, 0.5 - (count * dFW * FW) / 2 - FW, 0.5 + (count * dFW * FW) / 2 + FW, 0.5 + (count * dFW * FW) / 2 + FW];
              const m = minDet(map, box);
              worst = Math.min(worst, m);
              expect(m, `${count} faces ${dFW.toFixed(1)} FW ${deg}° yaw ${yaw}`).toBeGreaterThanOrEqual(MIN_DET);
              if (dFW >= 1.2 - 1e-9) {
                const alone = reshapeMapMulti([tf(faces[0], u)], 1);
                expect(featureMean(map, faces[0]) / featureMean(alone, faces[0])).toBeGreaterThanOrEqual(0.9);
              }
            }
    console.log(`sweep worst min det J ${worst.toFixed(3)}`);
  }, 180_000);
  it('touching faces (0.3 and 0.5 FW apart) stay finite and fold-free (Review Focus #2)', () => {
    const u = reshapeUniforms(params(['shape.faceSlim', 'shape.faceV', 'shape.eyeEnlarge', 'shape.chin']), 1);
    for (const d of [0.3, 0.5]) {
      const faces = [placed(0.5 - (d * 0.12) / 2, 0.5, 0.12), placed(0.5 + (d * 0.12) / 2, 0.5, 0.12)];
      const caps = capsFor(faces.map((f) => boxCentre(ovalBox(f))), [], 1);
      const map = reshapeMapMulti(faces.map((f, i) => tf(f, u, { cap: caps[i] })), 1);
      expect(minDet(map, [0.3, 0.3, 0.7, 0.7])).toBeGreaterThanOrEqual(MIN_DET);
    }
  });
  it('an obstacle (a dropped face) that is the nearest neighbour sets the cap', () => {
    const A = placed(0.4, 0.5, 0.12);
    const caps = capsFor([boxCentre(ovalBox(A)), [0.9, 0.5]], [[0.47, 0.5]], 1);
    expect(caps[0]).toBeCloseTo(Math.abs(0.47 - boxCentre(ovalBox(A))[0]) / 2, 6);
  });
});
```

(`params`, `reshapeUniforms`, `setParam`, `applyPreset`, `face`, `aspect` are already defined/imported at the top of `reshapeCpu.test.ts`.)

Run: `npx vitest run src/engine/passes/faceCap.test.ts src/engine/passes/reshapeCpu.test.ts`
Expected: FAIL (missing exports).

- [x] **Step 3: Write `src/engine/passes/faceTable.ts` and append to `src/engine/passes/faceCap.ts`**

`src/engine/passes/faceTable.ts`:

```ts
// The face table's layout (S §4.4): texel offsets inside a face's 96-texel row. A leaf module: reshape.ts builds its
// shader text from it at load time, and faceCap.ts packs rows with it. 70–71 are reserved (step 5 right-side
// strengths), 75–95 spare (step 5).
export const FT = { ROW: 96, PTS: 0, EXT: 56, VT: 60, NT: 63, CHIN_EYE: 65, S1: 66, S2: 67, RADII: 68, PROT: 69, RIGHT: 70, BOX: 72, CAP: 73, WIN: 74 } as const;
```

Append to `faceCap.ts` (add imports: `import { EMPTY_BOX, faceWidthIso, PROTECT_RAMP, PROTECT_REACH, PROTECT_SLOPE, PROTECT_SMOOTH, RESHAPE_SCALE, reshapeGeometry, yawAttenuation, type ReshapeUniforms } from './reshape';` and `import { FT } from './faceTable';`; `reshape.ts` imports `faceCap.ts` from Task 17 on, and that cycle is safe because neither module reads the other's bindings at load time):

```ts
export { FT } from './faceTable';
export const WHOLE: Rect = { x: 0, y: 0, w: 1, h: 1 };

export interface TableFace {
  face: Face;
  u: ReshapeUniforms;
  layer: number;
  window: Rect;
  centre: [number, number];
  cap: number;
}

/** RB §2.4 yaw attenuation of every delta (what ReshapePass.draw did, reshape.ts:360-362) */
export function attenuate(u: ReshapeUniforms, yaw: number): ReshapeUniforms {
  const att = yawAttenuation(yaw);
  const k = { ...u };
  for (const key of Object.keys(k) as (keyof ReshapeUniforms)[]) k[key] *= att;
  return k;
}

/** any non-zero delta (not reshapeActive's 1e-4): the face chain runs, as today (reshape.ts:363-365) */
export function faceDrawn(u: ReshapeUniforms): boolean {
  return Object.values(u).some((v) => v !== 0);
}

/**
 * cap_f = ½ · min over the other listed faces (weight 0 included) and every obstacle of isoDist(c_f, c_g) / p_g, with
 * p_g a neighbour track's presence in the camera (clamped below at 1e-3; 0 = not there) and 1 otherwise (S §4.1).
 * −1: no neighbour, so one face warps exactly as v0.3. 0 (coincident centres) is a valid cap with zero influence.
 */
export function capsFor(
  centres: readonly (readonly [number, number])[],
  obstacles: readonly (readonly [number, number])[],
  aspect: number,
  presence?: readonly number[],
): number[] {
  const iso = (a: readonly [number, number], b: readonly [number, number]) => Math.hypot(a[0] - b[0], (a[1] - b[1]) / aspect);
  return centres.map((c, f) => {
    let best = Infinity;
    centres.forEach((g, j) => {
      if (j === f) return;
      const p = presence ? presence[j] : 1;
      if (!(p > 0)) return;
      best = Math.min(best, iso(c, g) / Math.max(p, 1e-3));
    });
    for (const o of obstacles) best = Math.min(best, iso(c, o));
    return Number.isFinite(best) ? best / 2 : -1;
  });
}

/** UV AABB of the iso disc (centre, cap) */
export function capBox(centre: readonly [number, number], cap: number, aspect: number): [number, number, number, number] {
  return [centre[0] - cap, centre[1] - cap * aspect, centre[0] + cap, centre[1] + cap * aspect];
}

/** the box the shader tests (texel 72): the warp discs' box, clipped to the cap disc's AABB; EMPTY_BOX when nothing moves */
export function influenceBox(t: TableFace, aspect: number): [number, number, number, number] {
  if (!faceDrawn(t.u)) return [...EMPTY_BOX];
  const b = reshapeGeometry(t.face, aspect, t.u).box;
  if (t.cap < 0) return b;
  const c = capBox(t.centre, t.cap, aspect);
  const out: [number, number, number, number] = [Math.max(b[0], c[0]), Math.max(b[1], c[1]), Math.min(b[2], c[2]), Math.min(b[3], c[3])];
  return out[0] <= out[2] && out[1] <= out[3] ? out : [...EMPTY_BOX];
}

/** the box every 美型 item at its maximum (both ends of the bidirectional ones) could reach: sizes the protect window (A3) */
export function uMaxBox(face: Face, aspect: number): [number, number, number, number] {
  return reshapeGeometry(face, aspect, { ...RESHAPE_SCALE }).box;
}

/** Pack the face table (S §4.4) for MAX_RENDER_FACES rows; `out` holds faces.length × 96 × 4 floats or more. */
export function packFaceTable(faces: readonly TableFace[], aspect: number, out: Float32Array): void {
  out.fill(0);
  faces.forEach((t, f) => {
    const o = f * FT.ROW * 4;
    const at = (texel: number, a: number, b: number, c: number, d: number) => out.set([a, b, c, d], o + texel * 4);
    out.set(t.face.pts111, o + FT.PTS * 4);
    out.set(t.face.ext, o + FT.EXT * 4);
    const u = t.u;
    const g = reshapeGeometry(t.face, aspect, u);
    out.set(g.vTargets, o + FT.VT * 4);
    out.set(g.narrowTargets, o + FT.NT * 4);
    at(FT.CHIN_EYE, g.chinTarget[0], g.chinTarget[1], g.eyeDisp[0], g.eyeDisp[1]);
    at(FT.S1, u.faceSlim, u.faceV, u.faceNarrow, u.chin);
    at(FT.S2, u.forehead, u.noseSlim, u.mouthSize, u.eyeEnlarge);
    at(FT.RADII, g.eyeR[0], g.eyeR[1], g.mouthR, t.layer);
    const fw = faceWidthIso(t.face, aspect);
    at(FT.PROT, PROTECT_REACH * fw, PROTECT_SLOPE, PROTECT_RAMP, PROTECT_SMOOTH * fw);
    const box = influenceBox(t, aspect);
    at(FT.BOX, box[0], box[1], box[2], box[3]);
    at(FT.CAP, t.centre[0], t.centre[1], t.cap, PROTECT_SMOOTH * fw);
    at(FT.WIN, t.window.x, t.window.y, 1 / t.window.w, 1 / t.window.h);
  });
}
```

- [x] **Step 4: Rewrite `src/engine/passes/reshapeCpu.ts` as the N-face port**

```ts
// Test / harness-only CPU port of RESHAPE_FS (reshape.ts): the backward map vUv → tc the P2 reshape pass samples the
// source at. v0.4 (S §4.4): the 美體 field is the outermost map; every listed face's chain (contour curveWarps, chin,
// forehead, the per-face 瘦臉 limit, nose, mouth, eye distance, big eyes) starts from the same tcB, a capped face's
// displacement is held within its cap budget, and the displacements are summed — one face without a cap is its own chain
// output, bit-exact with v0.3 (reshapeCpuV03.ts). Double precision throughout; the e2e reshape pins compare the GPU with
// this port within 0.05 px. Never imported by the app.
import type { BodyField, Face, FaceProtect, Rect } from '../../types';
import { fieldAt } from '../../body/cpuWarp';
import { attenuate, boxCentre, faceDrawn, influenceBox, ovalBox, WHOLE, type TableFace } from './faceCap';
import { faceWidthIso, NARROW, NOSE, PROTECT_RAMP, PROTECT_REACH, PROTECT_SLOPE, PROTECT_SMOOTH, reshapeGeometry, SLIM, V_JAW, type ReshapeUniforms } from './reshape';

/** output UV → source UV (backward) */
export type UvMap = (u: number, v: number) => [number, number];

type V2 = [number, number];

/** the engine uploads FaceProtect as R16F: what the shader reads back */
const f16 = (Math as { f16round?: (x: number) => number }).f16round ?? ((x: number) => x);

/** Bilinear, clamp-to-edge lookup of a FaceProtect at its grid's UV, like the shader's texture lookup (texel centres at +0.5). */
export function protectAt(p: FaceProtect, u: number, v: number): number {
  const { width: w, height: h, data } = p;
  const x = Math.max(0, Math.min(w - 1, u * w - 0.5));
  const y = Math.max(0, Math.min(h - 1, v * h - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const t = (i: number) => f16(data[i]);
  const a = t(y0 * w + x0) * (1 - fx) + t(y0 * w + x1) * fx;
  const b = t(y1 * w + x0) * (1 - fx) + t(y1 * w + x1) * fx;
  return a * (1 - fy) + b * fy;
}

/** the 瘦臉 limit's budget (reshape.ts budgetScale): Ln / L, or 1 when the budget does not bind */
function budgetScale(L: number, t: number, l: number, slope: number, k: number): number {
  const x = t / Math.max(l, 1e-6);
  const B = t <= 0 ? 0 : t < l ? slope * l * x * x * x * (1 - 0.5 * x) : slope * (t - 0.5 * l);
  const h = Math.max(k - Math.abs(L - B), 0) / k;
  const Ln = Math.max(Math.min(L, B) - 0.25 * h * h * k, 0);
  return Ln >= L ? 1 : Ln / L;
}

/** one face's chain (reshape.ts faceChain), operation for operation */
function chainOf(face: Face, u: ReshapeUniforms, aspect: number, prot: FaceProtect | null, win: Rect): (tc: V2) => V2 {
  const g = reshapeGeometry(face, aspect, u);
  const P = face.pts111;
  const E = face.ext;
  const pt = (i: number): V2 => [P[i * 2], P[i * 2 + 1]];
  const ext = (i: number): V2 => [E[i * 2], E[i * 2 + 1]];
  const isoD = (a: V2, b: V2) => Math.hypot(a[0] - b[0], (a[1] - b[1]) / aspect);
  const curveWarp = (tc: V2, o: V2, t: V2, d: number): V2 => {
    const dir: V2 = [(t[0] - o[0]) * d, (t[1] - o[1]) * d];
    const r = Math.max(isoD(t, o), 1e-6);
    const k = Math.min(1, Math.max(0, 1 - isoD(tc, o) / r));
    return [tc[0] - dir[0] * k, tc[1] - dir[1] * k];
  };
  const enlargeEye = (tc: V2, c: V2, R: number, d: number): V2 => {
    let w = isoD(tc, c) / Math.max(R, 1e-6);
    w = Math.min(1, Math.max(0, 1 - (1 - w * w) * d));
    return [c[0] + (tc[0] - c[0]) * w, c[1] + (tc[1] - c[1]) * w];
  };
  const scaleAround = (tc: V2, c: V2, R: number, d: number): V2 => {
    const w = isoD(tc, c) / Math.max(R, 1e-6);
    if (w >= 1) return tc;
    const s = 1 - (1 - w * w) * d;
    return [c[0] + (tc[0] - c[0]) * s, c[1] + (tc[1] - c[1]) * s];
  };
  const shiftAround = (tc: V2, c: V2, R: number, disp: V2): V2 => {
    const w = isoD(tc, c) / Math.max(R, 1e-6);
    const k = Math.min(1, Math.max(0, 1 - w * w));
    return [tc[0] - disp[0] * k * k, tc[1] - disp[1] * k * k];
  };
  const fw = faceWidthIso(face, aspect);
  const reach = PROTECT_REACH * fw;
  const kappa = PROTECT_SMOOTH * fw;
  const protectContour = (tc0: V2, tc: V2): V2 => {
    const gx: V2 = [tc[0] - tc0[0], tc[1] - tc0[1]];
    const L = Math.hypot(gx[0], gx[1] / aspect);
    const t = reach - protectAt(prot!, (tc0[0] - win.x) * (1 / win.w), (tc0[1] - win.y) * (1 / win.h));
    const s = budgetScale(L, t, PROTECT_RAMP * reach, PROTECT_SLOPE, kappa);
    return s >= 1 ? tc : [tc0[0] + gx[0] * s, tc0[1] + gx[1] * s];
  };
  return (tcIn) => {
    let tc = tcIn;
    const tc0 = tc;
    if (u.faceSlim !== 0) for (const [o, t] of SLIM) tc = curveWarp(tc, pt(o), pt(t), u.faceSlim);
    if (u.faceV !== 0) V_JAW.forEach((i, k) => (tc = curveWarp(tc, pt(i), [g.vTargets[k * 2], g.vTargets[k * 2 + 1]], u.faceV)));
    if (u.faceNarrow !== 0) NARROW.forEach((i, k) => (tc = curveWarp(tc, pt(i), [g.narrowTargets[k * 2], g.narrowTargets[k * 2 + 1]], u.faceNarrow)));
    if (u.chin !== 0) tc = curveWarp(tc, pt(16), g.chinTarget, u.chin);
    if (u.forehead !== 0) tc = curveWarp(tc, ext(0), ext(3), u.forehead);
    if (prot) tc = protectContour(tc0, tc);
    if (u.noseSlim !== 0) for (const [o, t] of NOSE) tc = curveWarp(tc, pt(o), pt(t), u.noseSlim);
    if (u.mouthSize !== 0) tc = scaleAround(tc, pt(106), g.mouthR, u.mouthSize);
    if (g.eyeDisp[0] !== 0 || g.eyeDisp[1] !== 0) {
      tc = shiftAround(tc, pt(74), g.eyeR[0], g.eyeDisp);
      tc = shiftAround(tc, pt(77), g.eyeR[1], [-g.eyeDisp[0], -g.eyeDisp[1]]);
    }
    if (u.eyeEnlarge !== 0) {
      tc = enlargeEye(tc, pt(74), g.eyeR[0], u.eyeEnlarge);
      tc = enlargeEye(tc, pt(77), g.eyeR[1], u.eyeEnlarge);
    }
    return tc;
  };
}

/** The map drawFaces renders with: `faces` exactly as packed (attenuated, × weight), `protects` indexed by layer. */
export function reshapeMapMulti(faces: readonly TableFace[], aspect: number, opts: { body?: BodyField | null; protects?: readonly FaceProtect[] } = {}): UvMap {
  const per = faces.map((t) => {
    if (!faceDrawn(t.u)) return null;
    const box = influenceBox(t, aspect);
    if (box[0] > box[2]) return null;
    const prot = t.layer >= 0 ? (opts.protects?.[t.layer] ?? null) : null;
    return { t, box, kappa: PROTECT_SMOOTH * faceWidthIso(t.face, aspect), chain: chainOf(t.face, t.u, aspect, prot, t.window) };
  });
  const body = opts.body ?? null;
  return (x, y) => {
    let tcB: V2 = [x, y];
    if (body) {
      const d = fieldAt(body, x, y);
      tcB = [x + d[0], y + d[1]];
    }
    let ax = 0;
    let ay = 0;
    let only = tcB;
    let hits = 0;
    let anyCap = false;
    for (const p of per) {
      if (!p) continue;
      const b = p.box;
      if (tcB[0] < b[0] || tcB[1] < b[1] || tcB[0] > b[2] || tcB[1] > b[3]) continue;
      const tc = p.chain(tcB);
      let dx = tc[0] - tcB[0];
      let dy = tc[1] - tcB[1];
      if (p.t.cap >= 0) {
        const t = p.t.cap - Math.hypot(tcB[0] - p.t.centre[0], (tcB[1] - p.t.centre[1]) / aspect);
        const s = budgetScale(Math.hypot(dx, dy / aspect), t, PROTECT_RAMP * p.t.cap, PROTECT_SLOPE, p.kappa);
        dx *= s;
        dy *= s;
        anyCap = true;
      }
      ax += dx;
      ay += dy;
      only = tc;
      hits++;
    }
    return hits === 1 && !anyCap ? only : [tcB[0] + ax, tcB[1] + ay];
  };
}

/**
 * One face as ReshapePass.draw renders it (v0.3's signature, kept for the straightness ratchet, faceProtect.test.ts and the
 * harnesses): yaw attenuation applied here, no cap, the limit (when given) as layer 0 over its window.
 */
export function reshapeMapCpu(face: Face | null, uIn: ReshapeUniforms | null, aspect: number, body?: BodyField | null, protect?: FaceProtect | null): UvMap {
  if (!face || !uIn) return reshapeMapMulti([], aspect, { body });
  const t: TableFace = { face, u: attenuate(uIn, face.yaw), layer: protect ? 0 : -1, window: protect?.window ?? WHOLE, centre: boxCentre(ovalBox(face)), cap: -1 };
  return reshapeMapMulti([t], aspect, { body, protects: protect ? [protect] : [] });
}
```

`src/types.ts` (CRLF), `FaceProtect`: add `/** UV rect the grid covers (a per-face window with ≥ 2 faces, S §4.7); absent = the whole photo */ window?: Rect;`.

- [x] **Step 5: Run**

Run: `npx vitest run src/engine src/tracking/faceProtect.test.ts src/body/straightness.test.ts && npm run typecheck`
Expected: PASS (the hash pin `'ced9563c'` still holds: the shader is unchanged until Task 17); the sweep prints its worst `min det J`.

- [x] **Step 6: Commit**

```bash
git add src/engine/passes/faceTable.ts src/engine/passes/faceCap.ts src/engine/passes/faceCap.test.ts src/engine/passes/reshapeCpu.ts src/engine/passes/reshapeCpuV03.ts src/engine/passes/reshapeCpu.test.ts src/types.ts
git commit -m "v0.4 step 1c: caps, face-table layout and the N-face CPU port with the fold/strength sweep"
```

---

### Task 17: `RESHAPE_FS` with the face table, texture arrays, `drawFaces`, GPU pins, bench R / RC / RP

**Files:**
- Modify: `src/engine/passes/reshape.ts:180-412`, `src/engine/passes/reshapeCpu.test.ts:32` (hash pin, intended change #4), `src/engine/gl/gl.ts` (append), `tests/e2e/pages/reshape.ts`, `tests/e2e/reshape.spec.ts`, `tests/e2e/pages/faceProtect.ts:117-142`, `src/bench/multiFace.ts` (append rows), `docs/superpowers/specs/2026-10-12-face-person-select-design.md` §6.4
- (No change to `pipeline.ts` yet: it keeps calling the one-face `draw`, now a wrapper; Task 18 switches it.)

**Interfaces:**
- Consumes: Task 16 (`FT`, `TableFace`, `packFaceTable`, `attenuate`, `ovalBox`, `boxCentre`, `WHOLE`), `MAX_RENDER_FACES`, `FACE_TABLE_CARRIER`.
- Produces:
  - `reshapeFs(carrier: 'texture' | 'ubo'): string`; `RESHAPE_FS = reshapeFs('texture')` (pinned).
  - `ReshapePass.drawFaces(src: Texture, dst: Framebuffer, faces: readonly TableFace[], opts?: { aspect?: number; body?: Texture | null; protects?: readonly FaceProtect[] }): void`.
  - `ReshapePass.draw(src, dst, face: Face | null, u: ReshapeUniforms | null, aspect?: number, body?: Texture | null, protect?: FaceProtect | null): void` (one face; `protect` is now the FaceProtect data, uploaded by the pass).
  - `createReshapePass(gl: GL, opts?: { carrier?: 'texture' | 'ubo' }): ReshapePass`.
  - `gl.ts`: `createTextureArray(gl: GL, w: number, h: number, layers: number, internalFormat: number): Texture & { layers: number }`; `bindTextureArray(gl: GL, unit: number, tex: WebGLTexture | null): void`.
  - `window.runReshapePinMulti(carrier: 'texture' | 'ubo'): PinCase[]` (`tests/e2e/pages/reshape.ts`).

- [x] **Step 1: Failing pin first**

In `src/engine/passes/reshapeCpu.test.ts`, change the pin test to check both variants and a structural property, so the old shader fails it:

```ts
  it('is pinned to the shader text: a RESHAPE_FS edit must be mirrored in reshapeCpu.ts (then update this hash)', () => {
    // The e2e reshape.spec.ts compares the port with the real shader pixel by pixel; this is the cheap tripwire.
    expect(RESHAPE_FS).toContain('uniform highp sampler2D uFaces');
    expect(reshapeFs('ubo')).toContain('#define FACE_TABLE_UBO');
    expect(shaderHash(RESHAPE_FS)).toBe(PINNED);
  });
```

with `import { RESHAPE_FS, reshapeFs, … } from './reshape';` and, at the top, `const PINNED = 'ced9563c';` (this task replaces the value in Step 4).

Run: `npx vitest run src/engine/passes/reshapeCpu.test.ts`
Expected: FAIL (`reshapeFs` is not exported).

- [x] **Step 2: GL helpers (`src/engine/gl/gl.ts`, append)**

```ts
/** A TEXTURE_2D_ARRAY (LINEAR, clamp) with storage for `layers` layers; uploads go through texSubImage3D. */
export function createTextureArray(gl: GL, w: number, h: number, layers: number, internalFormat: number): Texture & { layers: number } {
  const tex = gl.createTexture();
  if (!tex) throw new Error('createTexture failed');
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D_ARRAY, p, gl.LINEAR);
  for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D_ARRAY, p, gl.CLAMP_TO_EDGE);
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, internalFormat, w, h, layers, 0, gl.RED, gl.FLOAT, null);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
  return { tex, width: w, height: h, layers };
}

/** bindTexture binds TEXTURE_2D only (gl.ts:151-154); arrays need their own target */
export function bindTextureArray(gl: GL, unit: number, tex: WebGLTexture | null): void {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
}
```

- [x] **Step 3: Rewrite the shader and the pass (`src/engine/passes/reshape.ts:180-412`)**

Keep everything above `/** texture unit of uBodyDisp` unchanged. Replace from there to the end of the file with:

```ts
/** texture units of P2 (S §4.8): src 0, body 1, protect array 2, face table 3 (texture carrier) */
export const BODY_UNIT = 1;
export const PROTECT_UNIT = 2;
export const FACE_TABLE_UNIT = 3;
/** the std140 block binding of the UBO carrier */
export const FACE_UBO_BINDING = 0;

/** (see the v0.3 comment kept above PROTECT_REACH in this file for the 瘦臉 limit's construction) */
export const PROTECT_REACH = 0.3;
export const PROTECT_SLOPE = 0.45;
export const PROTECT_RAMP = 0.3;
export const PROTECT_SMOOTH = 0.025;

/** face width (contour 0 → 32) in iso units (fractions of the image width) */
export function faceWidthIso(face: Face, aspect: number): number {
  const P = face.pts111;
  return Math.hypot(P[0] - P[64], (P[1] - P[65]) / aspect);
}

const glslFloat = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/**
 * The N-face reshape (S §4.4): the body field is the outermost backward map; every listed face's chain starts from the
 * same tcB (detected-landmark coordinates, reshape.ts:288-290); a capped face's displacement is held within its cap
 * budget (the 瘦臉 limit's construction centred on c_f, 0 beyond cap_f); displacements are summed, and one face without a
 * cap is its own chain output, so a single face is bit-identical to v0.3. ONE resample of the source. The face table
 * (96 texels per face, faceCap.ts FT) rides in an RGBA32F NEAREST texture or a std140 UBO (FACE_TABLE_CARRIER).
 * reshapeCpu.ts is the CPU port; reshapeCpu.test.ts pins this text.
 */
export function reshapeFs(carrier: 'texture' | 'ubo'): string {
  return `#version 300 es
${carrier === 'ubo' ? '#define FACE_TABLE_UBO\n' : ''}precision highp float;
precision highp int;
in vec2 vUv;
uniform sampler2D uSrc;
uniform sampler2D uBodyDisp; // RG16F backward displacement in UV units, row 0 = image top
uniform float uBodyOn;
uniform mediump sampler2DArray uProtArr; // R16F signed distance (iso units) per face layer, row 0 = window top
uniform int uCount;
uniform float uAspect;  // W/H
out vec4 outColor;

const int MAX_RENDER_FACES = ${MAX_RENDER_FACES};
const float PROTECT_RAMP = ${glslFloat(PROTECT_RAMP)};
const float PROTECT_SLOPE = ${glslFloat(PROTECT_SLOPE)};
#ifdef FACE_TABLE_UBO
layout(std140) uniform FaceTab { vec4 uFaceTab[${FT.ROW * MAX_RENDER_FACES}]; };
vec4 F(int f, int i) { return uFaceTab[f * ${FT.ROW} + i]; }
#else
uniform highp sampler2D uFaces; // RGBA32F, NEAREST: one ${FT.ROW}-texel row per face
vec4 F(int f, int i) { return texelFetch(uFaces, ivec2(i, f), 0); }
#endif
vec2 pairOf(vec4 t, int k) { return (k & 1) == 0 ? t.xy : t.zw; }
vec2 P(int f, int k) { return pairOf(F(f, k >> 1), k); }
vec2 EXT(int f, int k) { return pairOf(F(f, ${FT.EXT} + (k >> 1)), k); }
vec2 VT(int f, int k) { return pairOf(F(f, ${FT.VT} + (k >> 1)), k); }
vec2 NT(int f, int k) { return pairOf(F(f, ${FT.NT} + (k >> 1)), k); }

vec2 iso(vec2 p) { return vec2(p.x, p.y / uAspect); }

// GPUPixel curveWarp: content within |t − o| of o moves toward t by up to d·(t − o).
vec2 curveWarp(vec2 tc, vec2 o, vec2 t, float d) {
  vec2 dir = (t - o) * d;
  float r = max(distance(iso(t), iso(o)), 1e-6);
  float k = clamp(1.0 - distance(iso(tc), iso(o)) / r, 0.0, 1.0);
  return tc - dir * k;
}

// GPUPixel enlargeEye: magnify only (weight clamped to [0,1]).
vec2 enlargeEye(vec2 tc, vec2 c, float R, float d) {
  float w = distance(iso(tc), iso(c)) / max(R, 1e-6);
  w = clamp(1.0 - (1.0 - w * w) * d, 0.0, 1.0);
  return c + (tc - c) * w;
}

// Bidirectional scale; monotonic (no fold) for |d| <= 0.5.
vec2 scaleAround(vec2 tc, vec2 c, float R, float d) {
  float w = distance(iso(tc), iso(c)) / max(R, 1e-6);
  return w >= 1.0 ? tc : c + (tc - c) * (1.0 - (1.0 - w * w) * d);
}

// Local translate: content near c moves by disp, smoothly fading to 0 at R.
vec2 shiftAround(vec2 tc, vec2 c, float R, vec2 disp) {
  float w = distance(iso(tc), iso(c)) / max(R, 1e-6);
  float k = clamp(1.0 - w * w, 0.0, 1.0);
  return tc - disp * k * k;
}

// The 瘦臉 limit's budget and smooth minimum (v0.3 protectContour), factored out: Ln / L, or 1.0 when it does not bind.
float budgetScale(float L, float t, float l, float slope, float k) {
  float x = t / max(l, 1e-6);
  float B = t <= 0.0 ? 0.0 : (t < l ? slope * l * x * x * x * (1.0 - 0.5 * x) : slope * (t - 0.5 * l));
  float h = max(k - abs(L - B), 0.0) / k;
  float Ln = max(min(L, B) - 0.25 * h * h * k, 0.0);
  return Ln >= L ? 1.0 : Ln / L;
}

// 瘦臉 background limit of face f: keep |tc − tc0| within the person-distance budget of its layer (window: texel 74).
vec2 protectContour(int f, vec2 tc0, vec2 tc, float layer) {
  vec4 pr = F(f, ${FT.PROT});
  vec4 win = F(f, ${FT.WIN});
  vec2 g = tc - tc0;
  float L = length(iso(g));
  // textureLod: non-uniform control flow (after a per-fragment continue), where implicit derivatives are undefined
  float sd = textureLod(uProtArr, vec3((tc0 - win.xy) * win.zw, layer), 0.0).r;
  float s = budgetScale(L, pr.x - sd, pr.z * pr.x, pr.y, pr.w);
  return s >= 1.0 ? tc : tc0 + g * s;
}

const ivec2 SLIM[9] = ivec2[9](ivec2(3,44), ivec2(29,44), ivec2(7,45), ivec2(25,45),
                               ivec2(10,46), ivec2(22,46), ivec2(14,49), ivec2(18,49), ivec2(16,49));
const int V_JAW[6] = int[6](8, 10, 12, 24, 22, 20);
const int NARROW[4] = int[4](2, 4, 30, 28);
const ivec2 NOSE[4] = ivec2[4](ivec2(80,46), ivec2(81,46), ivec2(82,49), ivec2(83,49));

vec2 faceChain(int f, vec2 tc) {
  vec2 tc0 = tc;
  vec4 s1 = F(f, ${FT.S1});        // slim, v, narrow, chin
  vec4 s2 = F(f, ${FT.S2});        // forehead, nose, mouth, eye
  vec4 r = F(f, ${FT.RADII});      // eyeR.x, eyeR.y, mouthR, protect layer (−1 = none)
  vec4 ce = F(f, ${FT.CHIN_EYE});  // chinTarget, eyeDisp
  if (s1.x != 0.0) {
    for (int i = 0; i < 9; i++) tc = curveWarp(tc, P(f, SLIM[i].x), P(f, SLIM[i].y), s1.x);
  }
  if (s1.y != 0.0) {
    for (int i = 0; i < 6; i++) tc = curveWarp(tc, P(f, V_JAW[i]), VT(f, i), s1.y);
  }
  if (s1.z != 0.0) {
    for (int i = 0; i < 4; i++) tc = curveWarp(tc, P(f, NARROW[i]), NT(f, i), s1.z);
  }
  if (s1.w != 0.0) tc = curveWarp(tc, P(f, 16), ce.xy, s1.w);
  if (s2.x != 0.0) tc = curveWarp(tc, EXT(f, 0), EXT(f, 3), s2.x);
  if (r.w >= 0.0) tc = protectContour(f, tc0, tc, r.w);
  if (s2.y != 0.0) {
    for (int i = 0; i < 4; i++) tc = curveWarp(tc, P(f, NOSE[i].x), P(f, NOSE[i].y), s2.y);
  }
  if (s2.z != 0.0) tc = scaleAround(tc, P(f, 106), r.z, s2.z);
  if (ce.zw != vec2(0.0)) {
    tc = shiftAround(tc, P(f, 74), r.x, ce.zw);
    tc = shiftAround(tc, P(f, 77), r.y, -ce.zw);
  }
  if (s2.w != 0.0) {
    tc = enlargeEye(tc, P(f, 74), r.x, s2.w);
    tc = enlargeEye(tc, P(f, 77), r.y, s2.w);
  }
  return tc;
}

void main() {
  vec2 tcB = vUv;
  // Body first as a backward map = face first in forward terms: the face chains still see detected-landmark coordinates.
  if (uBodyOn != 0.0) tcB += uBodyOn * texture(uBodyDisp, vUv).xy;
  vec2 acc = vec2(0.0);
  vec2 only = tcB;
  int hits = 0;
  bool anyCap = false;
  for (int f = 0; f < MAX_RENDER_FACES; f++) {
    if (f >= uCount) break;
    vec4 box = F(f, ${FT.BOX});
    if (any(lessThan(tcB, box.xy)) || any(greaterThan(tcB, box.zw))) continue;
    vec2 tc = faceChain(f, tcB);
    vec2 d = tc - tcB;
    vec4 cap = F(f, ${FT.CAP});
    if (cap.z >= 0.0) {
      d *= budgetScale(length(iso(d)), cap.z - distance(iso(tcB), iso(cap.xy)), PROTECT_RAMP * cap.z, PROTECT_SLOPE, cap.w);
      anyCap = true;
    }
    acc += d;
    only = tc;
    hits++;
  }
  // one face without a cap: its chain output itself, so the single-face map is bit-identical to v0.3
  vec2 tc = (hits == 1 && !anyCap) ? only : tcB + acc;
  outColor = texture(uSrc, tc);
}`;
}

/** exported for the CPU port's sync check (reshapeCpu.test.ts) */
export const RESHAPE_FS = reshapeFs('texture');

/** uBox that no coordinate falls in: the face chain is skipped entirely (no face / all face deltas 0). */
export const EMPTY_BOX = [1e9, 1e9, -1e9, -1e9] as const;

export interface ReshapePass {
  /**
   * Sample `src` (any size, by UV) and write the warped image into `dst`. `faces` exactly as packed (yaw-attenuated,
   * × weight; faceCap.ts TableFace), at most MAX_RENDER_FACES; `protects[layer]` are their 瘦臉 limits (all the same
   * size: the photo grid for one face, PROTECT_WINDOW² windows for ≥ 2); `aspect` defaults to dst's (pass the image's
   * for the ¼-res mask); `body` = RG16F backward displacement texture.
   */
  drawFaces(src: Texture, dst: Framebuffer, faces: readonly TableFace[], opts?: { aspect?: number; body?: Texture | null; protects?: readonly FaceProtect[] }): void;
  /** One face with v0.3's signature (harnesses, pins): yaw attenuation applied here; `protect` = the limit's data. */
  draw(src: Texture, dst: Framebuffer, face: Face | null, u: ReshapeUniforms | null, aspect?: number, body?: Texture | null, protect?: FaceProtect | null): void;
  dispose(): void;
}

export function createReshapePass(gl: GL, opts: { carrier?: 'texture' | 'ubo' } = {}): ReshapePass {
  const carrier = opts.carrier ?? 'texture';
  const prog: Program = createProgram(gl, FULLSCREEN_VS, reshapeFs(carrier), 'reshape');
  prog.use();
  gl.uniform1i(prog.u('uSrc'), 0);
  gl.uniform1i(prog.u('uBodyDisp'), BODY_UNIT);
  gl.uniform1i(prog.u('uProtArr'), PROTECT_UNIT);
  const table = new Float32Array(FT.ROW * MAX_RENDER_FACES * 4);
  let uploaded: Float32Array | null = null;
  let tableTex: Texture | null = null;
  let ubo: WebGLBuffer | null = null;
  if (carrier === 'texture') {
    gl.uniform1i(prog.u('uFaces'), FACE_TABLE_UNIT);
    tableTex = createTexture(gl, FT.ROW, MAX_RENDER_FACES, { internalFormat: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT, filter: gl.NEAREST });
  } else {
    gl.uniformBlockBinding(prog.program, gl.getUniformBlockIndex(prog.program, 'FaceTab'), FACE_UBO_BINDING);
    ubo = gl.createBuffer();
    gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
    gl.bufferData(gl.UNIFORM_BUFFER, table.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.UNIFORM_BUFFER, null);
  }
  // Bound on the body unit when there is no field, so a sampler never reads an empty unit.
  const zero = createTexture(gl, 1, 1);
  const zeroArr = createTextureArray(gl, 1, 1, 1, gl.R16F);
  let protArr: (Texture & { layers: number }) | null = null;
  /** what each layer holds: re-uploaded only when its object, data or version changes */
  let layerKeys: { p: FaceProtect; data: Float32Array; version: number }[] = [];
  let warned = false;

  const uploadProtects = (protects: readonly FaceProtect[]): boolean[] => {
    if (!protects.length) return [];
    const w = protects[0].width;
    const h = protects[0].height;
    const ok = protects.map((p) => p.width === w && p.height === h && p.data.length >= w * h && p.data.every(Number.isFinite));
    if (ok.includes(false) && !warned) {
      warned = true;
      console.warn('[engine] ignoring a malformed or mismatched face limit layer');
    }
    if (!protArr || protArr.width !== w || protArr.height !== h || protArr.layers < protects.length) {
      if (protArr) gl.deleteTexture(protArr.tex);
      protArr = createTextureArray(gl, w, h, protects.length, gl.R16F);
      layerKeys = [];
    }
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, protArr.tex);
    setUnpackState(gl);
    protects.forEach((p, i) => {
      const k = layerKeys[i];
      if (!ok[i] || (k && k.p === p && k.data === p.data && k.version === p.version)) return;
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, w, h, 1, gl.RED, gl.FLOAT, p.data.subarray(0, w * h));
      layerKeys[i] = { p, data: p.data, version: p.version };
    });
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    return ok;
  };

  const drawFaces: ReshapePass['drawFaces'] = (src, dst, facesIn, o = {}) => {
    const aspect = o.aspect ?? dst.width / dst.height;
    const ok = uploadProtects(o.protects ?? []);
    const faces = facesIn.slice(0, MAX_RENDER_FACES).map((t) => (t.layer >= 0 && !ok[t.layer] ? { ...t, layer: -1 } : t));
    packFaceTable(faces, aspect, table);
    const n = faces.length * FT.ROW * 4;
    const changed = !uploaded || uploaded.length !== n || uploaded.some((v, i) => v !== table[i]);
    if (changed) {
      if (tableTex) {
        gl.bindTexture(gl.TEXTURE_2D, tableTex.tex);
        setUnpackState(gl);
        if (faces.length) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, FT.ROW, faces.length, gl.RGBA, gl.FLOAT, table.subarray(0, n));
      } else {
        gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
        gl.bufferSubData(gl.UNIFORM_BUFFER, 0, table);
        gl.bindBuffer(gl.UNIFORM_BUFFER, null);
      }
      uploaded = table.slice(0, n);
    }
    bindTarget(gl, dst);
    gl.disable(gl.BLEND);
    prog.use();
    bindTexture(gl, 0, src);
    bindTexture(gl, BODY_UNIT, o.body ?? zero);
    gl.uniform1f(prog.u('uBodyOn'), o.body ? 1 : 0);
    bindTextureArray(gl, PROTECT_UNIT, protArr && o.protects?.length ? protArr.tex : zeroArr.tex);
    if (tableTex) bindTexture(gl, FACE_TABLE_UNIT, tableTex);
    else gl.bindBufferBase(gl.UNIFORM_BUFFER, FACE_UBO_BINDING, ubo);
    gl.uniform1i(prog.u('uCount'), faces.length);
    gl.uniform1f(prog.u('uAspect'), aspect);
    drawFullscreen(gl);
    bindTexture(gl, BODY_UNIT, null);
    bindTextureArray(gl, PROTECT_UNIT, null);
    if (tableTex) bindTexture(gl, FACE_TABLE_UNIT, null);
    else gl.bindBufferBase(gl.UNIFORM_BUFFER, FACE_UBO_BINDING, null);
    gl.activeTexture(gl.TEXTURE0);
  };

  return {
    drawFaces,
    draw(src, dst, face, u, aspectIn, body, protect) {
      const faces: TableFace[] = face && u ? [{ face, u: attenuate(u, face.yaw), layer: protect ? 0 : -1, window: protect?.window ?? WHOLE, centre: boxCentre(ovalBox(face)), cap: -1 }] : [];
      drawFaces(src, dst, faces, { aspect: aspectIn, body, protects: protect ? [protect] : [] });
    },
    dispose() {
      prog.dispose();
      deleteTexture(gl, zero);
      gl.deleteTexture(zeroArr.tex);
      if (protArr) gl.deleteTexture(protArr.tex);
      deleteTexture(gl, tableTex);
      if (ubo) gl.deleteBuffer(ubo);
      protArr = null;
      layerKeys = [];
      uploaded = null;
    },
  };
}
```

Update the imports at the top of `reshape.ts`: `import { MAX_RENDER_FACES } from '../../config/limits';`, `import type { Face, FaceProtect, ParamId } from '../../types';`, `import { bindTarget, bindTexture, bindTextureArray, createProgram, createTexture, createTextureArray, deleteTexture, drawFullscreen, FULLSCREEN_VS, setUnpackState } from '../gl/gl';`, `import type { Framebuffer, GL, Program, Texture } from '../gl/gl';`, `import { FT } from './faceTable';` and `import { attenuate, boxCentre, ovalBox, packFaceTable, WHOLE, type TableFace } from './faceCap';` (`RESHAPE_FS` reads `FT` at load time from the leaf module; nothing else crosses the reshape ↔ faceCap cycle at load time).

Remove the old `uniform … uPts[111]` program code and the v0.3 `draw` body: the file has exactly one shader now. Keep the v0.3 explanatory comment block of the 瘦臉 limit (`:185-201`) directly above the `PROTECT_*` constants.

The pipeline still calls `reshape.draw(base, b, rf, rru, undefined, body, prot)` with `prot` a `Texture` (`pipeline.ts:407-420`): until Task 18, pass the FaceProtect object instead — in `pipeline.ts` replace `const prot = faceWarp ? protectTexture(job.faceProtect) : null;` with `const prot = faceWarp ? job.faceProtect : null;` (the pass uploads it). Delete the private `protectTexture`, `protTex`, `protKey`, `protWarned` state (`pipeline.ts:253-255, 289-318, 502-508`): the pass owns the upload now. Keep the exported, tested `faceProtectValid`, `protectUploadNeeded` and `ProtectUploadKey` (`pipeline.ts:160-194`).

- [x] **Step 4: Re-pin the hash (intended change #4)**

Run: `npx vitest run src/engine/passes/reshapeCpu.test.ts -t pinned`
Expected: FAIL with `expected 'xxxxxxxx' to be 'ced9563c'` (an 8-hex-digit FNV-1a hash of the new text). Set `PINNED` to the received 8-digit value and rerun: PASS. (A hash pin is a tripwire, so its value can only come from the final shader text; the e2e pins below are what prove the port.)

- [x] **Step 5: GPU pins for N faces and both carriers**

`tests/e2e/pages/reshape.ts`: keep `runReshapePin` as is (it calls the one-face `draw`); add:

```ts
declare global {
  interface Window {
    runReshapePinMulti?: (carrier: 'texture' | 'ubo') => PinCase[];
  }
}

window.runReshapePinMulti = (carrier) => {
  // same identity-texture method as runReshapePin; faces: the fixture face, a shrunk copy beside it, an obstacle
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const gl = canvas.getContext('webgl2')!;
  gl.getExtension('EXT_color_buffer_float');
  gl.getExtension('OES_texture_float_linear');
  const { width: W, height: H } = landmarks;
  const aspect = W / H;
  const base = adapt({ points: new Float32Array(landmarks.points) }, W, H);
  const shrink = (f: Face, k: number, dx: number): Face => {
    const b = ovalBox(f);
    const c = [b.x + b.w / 2, b.y + b.h / 2];
    const m = (a: Float32Array) => a.map((v, i) => (i % 2 === 0 ? c[0] + (v - c[0]) * k + dx : c[1] + (v - c[1]) * k));
    return { pts111: m(f.pts111), ext: m(f.ext), oval: m(f.oval), yaw: f.yaw };
  };
  const A = shrink(base, 0.45, -0.24);
  const B = shrink(base, 0.45, 0.24);
  const at = (ids: ParamId[]) => ids.reduce((p, k) => setParam(p, k, 1), applyPreset('original', 1)).values;
  const all: ParamId[] = ['shape.faceSlim', 'shape.faceV', 'shape.faceNarrow', 'shape.chin', 'shape.forehead', 'shape.noseSlim', 'shape.mouthSize', 'shape.eyeDistance', 'shape.eyeEnlarge'];
  const u = reshapeUniforms(at(all), 1);
  const tf = (f: Face, cap: number) => ({ face: f, u: attenuate(u, f.yaw), layer: -1, window: WHOLE, centre: boxCentre(ovalBox(f)), cap });
  const cA = boxCentre(ovalBox(A));
  const cB = boxCentre(ovalBox(B));
  const capAB = Math.hypot(cA[0] - cB[0], (cA[1] - cB[1]) / aspect) / 2;
  const obstacle: [number, number] = [cA[0] + 0.08, cA[1]];
  const capObs = Math.hypot(0.08, 0) / 2;
  const cases: { name: string; faces: TableFace[] }[] = [
    { name: `two faces, every warp (${carrier})`, faces: [tf(A, capAB), tf(B, capAB)] },
    { name: `capped pair, one neutral (${carrier})`, faces: [tf(A, capAB), { ...tf(B, capAB), u: reshapeUniforms(applyPreset('original', 1).values, 1) }] },
    { name: `obstacle bounds the cap (${carrier})`, faces: [tf(A, Math.min(capObs, capAB))] },
  ];
  return pinCases(gl, cases, aspect, carrier);
};
```

Factor today's per-case loop of `runReshapePin` (identity texture, RGBA32F target, readback, compare) into a local `pinCases(gl, cases, aspect, carrier)` helper that, for each case, calls `pass.drawFaces(src, dst, c.faces, { aspect })` on a `createReshapePass(gl, { carrier })` and compares with `reshapeMapMulti(c.faces, aspect)`, returning the same `PinCase` records; `runReshapePin` keeps its three cases through the one-face `draw` and `reshapeMapCpu` exactly as today. Imports: `attenuate, boxCentre, ovalBox, WHOLE, type TableFace` from `faceCap`, `reshapeMapMulti` from `reshapeCpu`, `Face` type.

`tests/e2e/reshape.spec.ts`, append:

```ts
test('reshape CPU port == RESHAPE_FS with N faces and caps, both face-table carriers (S §8.2)', async ({ page }) => {
  await page.goto(`${DEV_URL}/tests/e2e/pages/reshape.html`);
  await page.waitForFunction(() => typeof window.runReshapePinMulti === 'function');
  for (const carrier of ['texture', 'ubo'] as const) {
    const cases = await page.evaluate((c) => window.runReshapePinMulti!(c), carrier);
    expect(cases).toHaveLength(3);
    for (const c of cases) {
      console.log(`${c.name}: ${c.n} px, ${c.moved} moved, max |GPU − CPU| = ${c.maxErrPx.toFixed(4)} px`);
      expect(c.moved, c.name).toBeGreaterThan(300);
      expect(c.maxErrPx, c.name).toBeLessThan(0.05);
    }
  }
});
```

`tests/e2e/pages/faceProtect.ts`: `render(…, prot: Texture | null, …)` → `prot: FaceProtect | null`; at the call sites pass `c.protect` (or `null`) instead of `protTex(c.protect)`; delete `protTex` and the `deleteTexture(… pt.tex)` lines that freed it.

- [x] **Step 6: Bench rows R, RC, RP (`src/bench/multiFace.ts`, append)**

```ts
/** R: reshape microbench, N = 1…6 spread / 6 in a row at 1.2 FW / 2×3 at 1.3 FW, both carriers, 1080 and 2048; RC: compile + link; RP: GPU vs CPU pin */
export async function rowR(): Promise<MultiRow[]> {
  const { adapt } = await import('../tracking/adapter111');
  const { createReshapePass, reshapeUniforms } = await import('../engine/passes/reshape');
  const { attenuate, boxCentre, capsFor, ovalBox, WHOLE } = await import('../engine/passes/faceCap');
  const { applyPreset, PARAM_DEFS, setParam } = await import('../engine/params');
  const { createFramebuffer, createTexture } = await import('../engine/gl/gl');
  const lm = await (await fetch('/tests/fixtures/landmarks_sample_face.json')).json();
  const base = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);
  const u = reshapeUniforms(PARAM_DEFS.filter((d) => d.group === 'shape').reduce((p, d) => setParam(p, d.id, 1), applyPreset('original', 1)).values, 1);
  const at = (cx: number, cy: number, k: number) => {
    const b = ovalBox(base);
    const c = [b.x + b.w / 2, b.y + b.h / 2];
    const m = (a: Float32Array) => a.map((v, i) => (i % 2 === 0 ? cx + (v - c[0]) * k : cy + (v - c[1]) * k));
    return { pts111: m(base.pts111), ext: m(base.ext), oval: m(base.oval), yaw: 0 };
  };
  const layouts: Record<string, [number, number][]> = {};
  for (let n = 1; n <= 6; n++) layouts[`spread ${n}`] = Array.from({ length: n }, (_, i) => [(i + 0.5) / n, 0.5]);
  layouts['row 6 @1.2FW'] = Array.from({ length: 6 }, (_, i) => [0.2 + i * 0.12, 0.5]);
  layouts['grid 2×3 @1.3FW'] = Array.from({ length: 6 }, (_, i) => [0.35 + (i % 3) * 0.13, 0.4 + Math.floor(i / 3) * 0.2]);
  const out: MultiRow[] = [];
  for (const carrier of ['texture', 'ubo'] as const) {
    for (const edge of [1080, 2048]) {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2')!;
      const t0 = performance.now();
      const pass = createReshapePass(gl, { carrier });
      const src = createTexture(gl, edge, edge);
      const dst = createFramebuffer(gl, edge, edge);
      pass.drawFaces(src, dst, [], {});
      const px = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      out.push({ row: 'RC', config: `${carrier} ${edge}`, values: { compile_ms: Math.round(performance.now() - t0) } });
      const time = (faces: Parameters<typeof pass.drawFaces>[2]) => {
        for (let i = 0; i < 30; i++) pass.drawFaces(src, dst, faces, { aspect: 1 });
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const batches: number[] = [];
        for (let b = 0; b < 10; b++) {
          const s = performance.now();
          for (let i = 0; i < 10; i++) pass.drawFaces(src, dst, faces, { aspect: 1 });
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          batches.push((performance.now() - s) / 10);
        }
        return median(batches);
      };
      const baseline = time([]);
      for (const [name, centres] of Object.entries(layouts)) {
        const k = name.startsWith('spread') ? 0.6 / centres.length : 0.12 / 0.62;
        const faces = centres.map(([x, y]) => at(x, y, k));
        const caps = capsFor(faces.map((f) => boxCentre(ovalBox(f))), [], 1);
        const tfs = faces.map((f, i) => ({ face: f, u: attenuate(u, 0), layer: -1, window: WHOLE, centre: boxCentre(ovalBox(f)), cap: caps[i] }));
        out.push({ row: 'R', config: `${carrier} ${edge} ${name}`, values: { ms: Math.round((time(tfs) - baseline) * 100) / 100 } });
      }
      pass.dispose();
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  }
  return out;
}
addRunner('R', () => rowR());
```

Add `'R'` to the buttons list in `mountMultiFace` (`for (const id of ['D', 'B', 'GL', 'R'])`). (RP: the e2e pin page runs in `/bench.html`'s dev server too; record its numbers by opening `/tests/e2e/pages/reshape.html` on the phone once a deploy exists — note this in §6.4.)

- [x] **Step 7: Run and record**

Run: `npx vitest run src/engine && npm run typecheck && npm run build`
Expected: PASS.

Run: `npx playwright test tests/e2e/reshape.spec.ts tests/e2e/faceProtect.spec.ts tests/e2e/parity.spec.ts tests/e2e/engine.spec.ts`
Expected: PASS (one-face pins unchanged within 0.05 px; the multi pins < 0.05 px for both carriers; parity ≤ 1/255).

Run: `node scripts/bench-multiface.mjs R`
Expected: R and RC rows. Append them to S §6.4 with the line `PR1/PRC (desktop): <fastest carrier and its N = 6 time>; FACE_TABLE_CARRIER stays 'texture' unless the UBO is faster on the slowest iPhone (pending a deploy).`

- [x] **Step 8: Commit**

```bash
git add src/engine/passes/reshape.ts src/engine/passes/reshapeCpu.test.ts src/engine/gl/gl.ts src/engine/pipeline.ts tests/e2e/pages/reshape.ts tests/e2e/reshape.spec.ts tests/e2e/pages/faceProtect.ts src/bench/multiFace.ts docs/superpowers/specs/2026-10-12-face-person-select-design.md
git commit -m "v0.4 step 1c: RESHAPE_FS with the face table (texture/UBO), summed capped displacements, protect array; pins"
```

---

### Task 18: `RenderInput` v0.4 — N faces through mask, makeup, reshape and composite

**Files:**
- Modify: `src/types.ts:276-292` (CRLF), `src/engine/uniforms.ts` (append), `src/engine/uniforms.test.ts` (append), `src/engine/passes/reshape.ts:49-65` (value type), `src/engine/passes/mask.ts` (CRLF), `src/engine/passes/mask.test.ts`, `src/engine/passes/makeup.ts:39-238` (CRLF), `src/engine/shaders/composite.ts:166-194` (CRLF), `src/engine/pipeline.ts` (CRLF), `src/engine/pipeline.test.ts:15-75`, `src/engine/index.ts:174-194,228-231` (CRLF), `src/engine/index.test.ts:78,91,101-110`, `src/app/still.ts`, `src/app/still.test.ts`, `src/app/live.ts:176-179,326-336` (CRLF), `src/app/live.test.ts` (CRLF), `src/app/testFakes.ts` (CRLF), `src/ui/editorModel.ts:15-24`, `src/ui/editorModel.test.ts:25-35`, `src/ui/screens/Editor.tsx` (interim), `src/bench/main.ts:445-470` (CRLF), `tests/e2e/pages/engine.ts`, `tests/e2e/pages/parity.ts`, `tests/e2e/pages/faceProtect.ts:224`, `tests/e2e/engine.spec.ts` (append), `tests/harness/t1/harness.ts` (mixed endings: keep each edited line's), `tests/harness/b2/harness.ts:215-222` (CRLF), `tests/harness/t7/fakes.ts:191,208,226`, `tests/harness/t8/still-main.ts:51-68`
- Create: `src/edit/frame.ts`, `src/edit/frame.test.ts`

**Interfaces:**
- Consumes: Tasks 13–17 (`prepareFaces`, `adaptCached`, `ovalBox`, `boxCentre`, `capsFor`, `attenuate`, `faceDrawn`, `WHOLE`, `TableFace`, `ReshapePass.drawFaces`), `personOf`, `neutralPerson`, `splitLegacy`, limits.
- Produces:
  - `RenderFace { face: Face; weight: number; person: PersonParams; protect: FaceProtect | null; presence?: number }`; `RenderInput { source; width; height; faces: readonly RenderFace[]; obstacles?: readonly [number, number][]; globalSkin: { smooth: number; rosy: number; weight: number } | null; photo: PhotoParams; body?: BodyField | null }`; `StillFrame = Omit<RenderInput, 'source' | 'width' | 'height' | 'body'>` (all in `src/types.ts`).
  - `src/edit/frame.ts`: `interface FrameFaceIn { id: string; face: Face; person: PersonId | null }`; `buildFrame(edit: EditState, faces: readonly FrameFaceIn[], obstacles: readonly CachedObstacle[], protects: ReadonlyMap<string, FaceProtect>, primary: PersonId): StillFrame`; `legacyFrame(params: BeautyParams, face: Face | null, weight: number, protect?: FaceProtect | null): StillFrame`.
  - `src/engine/uniforms.ts`: `skinMaxima(faces: readonly { weight: number; smooth: number; rosy: number }[], global: RenderInput['globalSkin']): { S: number; R: number; k: [number, number][]; clear: [number, number] }`; `skinUniformsFor(photo: PhotoParams, S: number, R: number, filterAvailable: boolean): SkinUniforms` (v1 `skinUniforms` stays for the harness / tests).
  - `makeupUniformsFor(person: PersonParams, weight: number): MakeupUniforms`; `MakeupPass.drawFaces(src, dst, faces: readonly { face: Face; u: MakeupUniforms }[])` (`draw` stays as the one-face form).
  - `MaskPass.drawFaces(dst, faces: readonly { face: Face; weight: number; k: readonly [number, number] }[], clear: readonly [number, number])`; `buildMaskGeometry` returns `[count, base, fanEnd]` (fans first, then rings, then holes).
  - `FrameFace { face; weight; reshape: ReshapeUniforms; makeup: MakeupUniforms; kS: number; kR: number; protect: FaceProtect | null; centre: [number, number]; presence: number }`; `FrameJob` gains `faces: FrameFace[]`, `obstacles`, `maskClear: [number, number]`, `photo: PhotoParams` and loses `face`, `faceWeight`, `faceProtect`, `params`; `PassPlanInput.anyFace` replaces `hasFace` / `faceWeight`; `tableFaces(job: Pick<FrameJob, 'faces' | 'obstacles'>, aspect: number): { faces: TableFace[]; protects: FaceProtect[] }`.
  - `StillSession`: `faces: readonly SessionFace[]` (`SessionFace { id; face: Face; box: Rect; lm: Float32Array }`), `obstacles: readonly CachedObstacle[]`, `dropped`, `render(frame: StillFrame)`, `prepareExport(frame)`, `exportReady(frame)`, `exportImageData(frame, body?)`; options `faces?: readonly CachedFace[]`, `obstacles?: readonly CachedObstacle[]` (replacing `face` / `faceProtect`); `setFaceProtect` / `faceProtect` removed (A6).
  - test helpers in `testFakes.ts`: `faceOf(i: RenderInput | undefined): Face | null`, `weightOf(i: RenderInput | undefined): number`.

- [x] **Step 1: Failing tests for the pure parts**

```ts
// src/edit/frame.test.ts
import { describe, expect, it } from 'vitest';
import { applyPreset } from '../engine/params';
import { makeFace } from '../app/testFakes';
import type { EditState, FaceProtect } from '../types';
import { buildFrame, legacyFrame } from './frame';
import { splitLegacy } from './legacy';
import { defaultPhoto, naturalPerson, neutralPerson } from './state';

const prot: FaceProtect = { width: 1, height: 1, data: new Float32Array(1), version: 1 };
const edit: EditState = { v: 2, photo: defaultPhoto(), persons: { f0: naturalPerson(), b1: naturalPerson() }, template: neutralPerson(), primaryInit: null };

describe('buildFrame (S §4.1)', () => {
  it('every face in cache order at weight 1 with its person (a face without a person: neutral), obstacles as centres', () => {
    const f = buildFrame(edit, [{ id: 'f0', face: makeFace(0, 0.3), person: 'f0' }, { id: 'f1', face: makeFace(1, 0.7), person: null }], [{ box: { x: 0.9, y: 0.1, w: 0.02, h: 0.02 }, oval: new Float32Array(72) }], new Map([['f0', prot]]), 'f0');
    expect(f.faces.map((x) => [x.weight, x.protect])).toEqual([[1, prot], [1, null]]);
    expect(f.faces[1].person).toEqual(neutralPerson());
    expect(f.obstacles).toHaveLength(1);
    expect(f.obstacles![0][0]).toBeCloseTo(0.91, 9);
    expect(f.obstacles![0][1]).toBeCloseTo(0.11, 9);
    expect(f.globalSkin).toBeNull();
    expect(f.photo).toBe(edit.photo);
  });
  it('no face: all-skin 磨皮／紅潤 from the primary person', () => {
    const f = buildFrame(edit, [], [], new Map(), 'b1');
    expect(f.globalSkin).toEqual({ smooth: 0.55, rosy: 0.25, weight: 1 });
  });
});

describe('legacyFrame (one face from v1 params: tests, harnesses, the v0.3 camera)', () => {
  it('a face at weight w fades the global skin to 1 − w; no face: weight 1, no faces', () => {
    const p = applyPreset('natural', 1);
    const f = legacyFrame(p, makeFace(), 0.25);
    expect(f.faces[0].weight).toBe(0.25);
    expect(f.globalSkin).toEqual({ smooth: 0.55, rosy: 0.25, weight: 0.75 });
    expect(f.photo).toEqual(splitLegacy(p).photo);
    expect(legacyFrame(p, null, 1).faces).toEqual([]);
    expect(legacyFrame(p, null, 1).globalSkin?.weight).toBe(1);
  });
});
```

Append to `src/engine/uniforms.test.ts` (import `skinMaxima, skinUniformsFor`; `splitLegacy` from `../edit/legacy`):

```ts
describe('skinMaxima (S §4.1 item 2, §4.2 clear)', () => {
  it('one editor face: S, R = its own; k = 1; clear 0 (bit-equal to v0.3)', () => {
    expect(skinMaxima([{ weight: 1, smooth: 0.55, rosy: 0.25 }], null)).toEqual({ S: 0.55, R: 0.35 * 0.25, k: [[1, 1]], clear: [0, 0] });
  });
  it('a camera fade: the global skin (same person) clears to 1 − w, the face writes w', () => {
    const m = skinMaxima([{ weight: 0.3, smooth: 0.6, rosy: 0.4 }], { smooth: 0.6, rosy: 0.4, weight: 0.7 });
    expect(m.k).toEqual([[1, 1]]);
    expect(m.clear[0]).toBeCloseTo(0.7);
    expect(m.clear[1]).toBeCloseTo(0.7);
  });
  it('two faces: the maxima and relative strengths; a weight-0 face is listed but sets no maximum', () => {
    const m = skinMaxima([{ weight: 1, smooth: 0.8, rosy: 0 }, { weight: 1, smooth: 0.4, rosy: 0.5 }, { weight: 0, smooth: 1, rosy: 1 }], null);
    expect(m.S).toBe(0.8);
    expect(m.k[1]).toEqual([0.5, 1]);
    expect(m.k[0][1]).toBe(0);
  });
  it('skinUniformsFor = v1 skinUniforms for one person', () => {
    const p = applyPreset('glow', 1);
    const { photo } = splitLegacy(p);
    expect(skinUniformsFor(photo, 0.55, 0.35 * 0.45, true)).toEqual(skinUniforms(p, true));
  });
});
```

`src/engine/passes/mask.test.ts`: the two existing tests read `[count, base]` and keep passing unchanged (the base still holds 36 · 9 vertices with values {0, 1}); add inside `describe('buildMaskGeometry')` (the file already imports `Face`, `FACE_TEMPLATE`, `MASK_MAX_FLOATS` and `buildMaskGeometry`, and defines `face()`: a 0.21 × 0.26 oval around (0.5, 0.47) on the GPUPixel template):

```ts
  it('fans come first (value 1), then the ring (1 → 0), then the holes', () => {
    const out = new Float32Array(MASK_MAX_FLOATS);
    const [, base, fanEnd] = buildMaskGeometry(face(), 1, out);
    expect(fanEnd).toBe(36 * 3);
    for (let v = 0; v < fanEnd; v++) expect(out[v * 3 + 2]).toBe(1);
    const ring = new Set<number>();
    for (let v = fanEnd; v < base; v++) ring.add(out[v * 3 + 2]);
    expect([...ring].sort()).toEqual([0, 1]);
  });

  /**
   * CPU raster of the 磨皮 channel in MaskPass.drawFaces' order (S §4.2): every ring with MAX, every fan with blending
   * off, every hole with MIN, each fragment k · smoothstep(0, 1, v) over a clear of 0 (the editor: no globalSkin).
   */
  function raster(faces: { f: Face; k: number }[], N: number): Float32Array {
    const img = new Float32Array(N * N);
    const geo = faces.map(({ f, k }) => {
      const out = new Float32Array(MASK_MAX_FLOATS);
      const [count, base, fanEnd] = buildMaskGeometry(f, 1, out);
      return { out, count, base, fanEnd, k };
    });
    const fill = (out: Float32Array, from: number, to: number, k: number, op: 'max' | 'set' | 'min') => {
      for (let t = from; t + 2 < to; t += 3) {
        const P = [0, 1, 2].map((j) => [out[(t + j) * 3], out[(t + j) * 3 + 1], out[(t + j) * 3 + 2]]);
        const [[x0, y0], [x1, y1], [x2, y2]] = P;
        const d = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
        if (Math.abs(d) < 1e-12) continue;
        for (let py = 0; py < N; py++) {
          for (let px = 0; px < N; px++) {
            const x = (px + 0.5) / N;
            const y = (py + 0.5) / N;
            const a = ((x1 - x) * (y2 - y) - (x2 - x) * (y1 - y)) / d;
            const b = ((x2 - x) * (y0 - y) - (x0 - x) * (y2 - y)) / d;
            const c = 1 - a - b;
            if (a < 0 || b < 0 || c < 0) continue;
            // GLSL smoothstep(0, 1, v) clamps v first
            const v = Math.min(1, Math.max(0, a * P[0][2] + b * P[1][2] + c * P[2][2]));
            const val = k * v * v * (3 - 2 * v);
            const i = py * N + px;
            img[i] = op === 'max' ? Math.max(img[i], val) : op === 'min' ? Math.min(img[i], val) : val;
          }
        }
      }
    };
    for (const g of geo) fill(g.out, g.fanEnd, g.base, g.k, 'max');
    for (const g of geo) fill(g.out, 0, g.fanEnd, g.k, 'set');
    for (const g of geo) fill(g.out, g.base, g.count, g.k, 'min');
    return img;
  }

  it('two faces in the pass order: a neutral face keeps 0 inside its oval although its neighbour’s ring reaches in (S §4.2, §8.2)', () => {
    const N = 160;
    const at = (img: Float32Array, x: number, y: number) => img[Math.floor(y * N) * N + Math.floor(x * N)];
    const shift = (f: Face, dx: number): Face => ({
      ...f,
      pts111: f.pts111.map((v, i) => (i % 2 === 0 ? v + dx : v)),
      oval: f.oval.map((v, i) => (i % 2 === 0 ? v + dx : v)),
    });
    // ovals 0.01 apart (A ends at x 0.495, B starts at 0.505); A's ring is 8 % of the template's 0.396 face width ≈ 0.032
    const img = raster([{ f: shift(face(), -0.215), k: 1 }, { f: shift(face(), 0.215), k: 0 }], N);
    expect(at(img, 0.5, 0.47)).toBeGreaterThan(0); // the gap: A's ring
    expect(at(img, 0.515, 0.47)).toBe(0); // inside B's oval, still within A's ring: B's own fan (strength 0) wins
    expect(at(img, 0.12, 0.47)).toBe(1); // A's cheek: its full strength
  });
```

In `src/engine/pipeline.test.ts`, port `planPasses` (mechanical): in `base` replace `hasFace: true, faceWeight: 1,` with `anyFace: true,`; `{ ...base, hasFace: false }` and `{ ...base, faceWeight: 0 }` → `{ ...base, anyFace: false }`; `:73` `i.hasFace && i.faceWeight > 0 && i.reshapeActive` → `i.anyFace && i.reshapeActive`. Append:

```ts
describe('tableFaces (S §4.1)', () => {
  const f = (cx: number, over: Partial<FrameFace> = {}): FrameFace => ({
    face: makeFace(0, cx),
    weight: 1,
    reshape: { faceSlim: 0.1, faceV: 0, faceNarrow: 0, chin: 0, forehead: 0, noseSlim: 0, mouthSize: 0, eyeDistance: 0, eyeEnlarge: 0 },
    makeup: { lip: 0, blush: 0, lipColor: null, blushColor: null },
    kS: 1,
    kR: 1,
    protect: null,
    centre: [cx, 0.5],
    presence: 1,
    ...over,
  });
  const prot = { width: 4, height: 4, data: new Float32Array(16), version: 1 };
  it('one face: no cap; its limit is layer 0 over the whole photo', () => {
    const t = tableFaces({ faces: [f(0.5, { protect: prot })], obstacles: [] }, 1);
    expect(t.faces[0]).toMatchObject({ cap: -1, layer: 0, window: { x: 0, y: 0, w: 1, h: 1 } });
    expect(t.protects).toEqual([prot]);
  });
  it('two faces and an obstacle: caps; a neutral or weight-0 face is listed with zero deltas and no layer', () => {
    const neutral = f(0.7, { reshape: { ...f(0).reshape, faceSlim: 0 }, protect: prot });
    const t = tableFaces({ faces: [f(0.3), neutral, f(0.9, { weight: 0 })], obstacles: [[0.4, 0.5]] }, 1);
    expect(t.faces[0].cap).toBeCloseTo(0.05);
    expect(t.faces[1].layer).toBe(-1);
    expect(Object.values(t.faces[2].u).every((v) => v === 0)).toBe(true);
  });
});
```

(import `tableFaces, type FrameFace` from `./pipeline` and `makeFace` from `../app/testFakes`.)

Run: `npx vitest run src/edit/frame.test.ts src/engine`
Expected: FAIL (missing exports / signatures).

- [x] **Step 2: Types and the pure parts**

`src/types.ts` (CRLF): replace `RenderInput` (`:276-292`) with the `RenderFace`, `RenderInput` and `StillFrame` declarations of the Interfaces block above (doc comments: "`faces` ≤ MAX_RENDER_FACES, table order = cache face order, so packing is deterministic; a face whose person is neutral is still listed so its skin mask writes 0 (others untouched) and it bounds its neighbours' caps"; "`globalSkin`: … the camera's "no face" fade (A2)").

`src/engine/passes/reshape.ts:49-65`: add `type ShapeId = Extract<ParamId, \`shape.${string}\`>;` and change the signature to `reshapeUniforms(values: Readonly<Record<ShapeId, number>>, faceWeight: number)` with the inner helpers typed `(id: ShapeId)`. (Callers passing a full `Record<ParamId, number>` still type-check; `PersonParams.values` now does too.)

`src/engine/uniforms.ts` (append; import `PhotoParams`, `RenderInput` types):

```ts
/**
 * The frame's skin strengths (S §4.1 item 2): S = max 磨皮 and R = max 0.35·紅潤 over the faces with weight > 0 and the
 * global skin; each face's relative strengths k = (smooth/S, 0.35·rosy/R) are written into the skin mask; the mask is
 * cleared to the global skin's (weight · strength / max). With one face this is v0.3 exactly: k = 1, clear 1 − w.
 */
export function skinMaxima(
  faces: readonly { weight: number; smooth: number; rosy: number }[],
  global: RenderInput['globalSkin'],
): { S: number; R: number; k: [number, number][]; clear: [number, number] } {
  let S = 0;
  let R = 0;
  for (const f of faces) {
    if (!(f.weight > 0)) continue;
    S = Math.max(S, clamp01(f.smooth));
    R = Math.max(R, ROSY_MAX_OPACITY * clamp01(f.rosy));
  }
  if (global) {
    S = Math.max(S, clamp01(global.smooth));
    R = Math.max(R, ROSY_MAX_OPACITY * clamp01(global.rosy));
  }
  const k = faces.map((f): [number, number] => [S > 0 ? clamp01(f.smooth) / S : 0, R > 0 ? (ROSY_MAX_OPACITY * clamp01(f.rosy)) / R : 0]);
  const w = global ? clamp01(global.weight) : 0;
  const clear: [number, number] = global
    ? [S > 0 ? (w * clamp01(global.smooth)) / S : 0, R > 0 ? (w * ROSY_MAX_OPACITY * clamp01(global.rosy)) / R : 0]
    : [0, 0];
  return { S, R, k, clear };
}

/** composite uniforms from the photo layer and the frame maxima (v1 skinUniforms for one person) */
export function skinUniformsFor(photo: PhotoParams, S: number, R: number, filterAvailable: boolean): SkinUniforms {
  const v = photo.values;
  return {
    smooth: S,
    sharpen: 2 * clamp01(v['skin.sharpen']),
    whiten: 0.5 * clamp01(v['skin.whiten']),
    rosy: R,
    filterAmount: filterAvailable && photo.filterId !== 'none' ? clamp01(v['filter.amount']) : 0,
  };
}
```

`src/edit/frame.ts`:

```ts
// The still frame of an edit (S §4.1 item 1): every selectable face in cache order at weight 1 with its person's params
// (a face whose person has no entry yet: neutral) and its 瘦臉 limit; the obstacles' centres; all-skin 磨皮／紅潤 from the
// primary person only when the photo has no face. The selection is never an input.
import { boxCentre } from '../engine/passes/faceCap';
import type { BeautyParams, CachedObstacle, EditState, Face, FaceProtect, PersonId, StillFrame } from '../types';
import { splitLegacy } from './legacy';
import { neutralPerson, personOf } from './state';

export interface FrameFaceIn {
  id: string;
  face: Face;
  /** the person linked to this face (DetectionCache.persons), null = none yet */
  person: PersonId | null;
}

export function buildFrame(
  edit: EditState,
  faces: readonly FrameFaceIn[],
  obstacles: readonly CachedObstacle[],
  protects: ReadonlyMap<string, FaceProtect>,
  primary: PersonId,
): StillFrame {
  const skin = personOf(edit, primary).values;
  return {
    faces: faces.map((f) => ({ face: f.face, weight: 1, person: f.person && edit.persons[f.person] ? edit.persons[f.person] : neutralPerson(), protect: protects.get(f.id) ?? null })),
    obstacles: obstacles.map((o) => boxCentre(o.box)),
    globalSkin: faces.length ? null : { smooth: skin['skin.smooth'], rosy: skin['skin.rosy'], weight: 1 },
    photo: edit.photo,
  };
}

/**
 * One face from v1 params (the camera until Task 25, unit tests, harnesses and e2e pages): the face at `weight`, the
 * global skin of the same person faded to 1 − weight (A2), so a fading camera face is v0.3's mask exactly.
 */
export function legacyFrame(params: BeautyParams, face: Face | null, weight: number, protect: FaceProtect | null = null): StillFrame {
  const { photo, person } = splitLegacy(params);
  const w = Number.isFinite(weight) ? Math.min(1, Math.max(0, weight)) : 0;
  const on = face !== null && w > 0;
  return {
    faces: on ? [{ face, weight: w, person, protect }] : [],
    obstacles: [],
    globalSkin: { smooth: person.values['skin.smooth'], rosy: person.values['skin.rosy'], weight: on ? 1 - w : 1 },
    photo,
  };
}
```

- [x] **Step 3: Mask (RGBA8, per face; `src/engine/passes/mask.ts`, CRLF)**

1. `MASK_FS` becomes:

```glsl
#version 300 es
precision highp float;
in float vVal;
uniform vec2 uG;   // the clear (gS, gR)
uniform vec2 uWK;  // this face: weight · (kS, kR)
out vec4 outColor;
void main() {
  float m = smoothstep(0.0, 1.0, vVal);
  outColor = vec4(uG + uWK * m, 0.0, 1.0);
}
```

2. In `buildMaskGeometry`, emit every fan triangle first, then the ring, then the holes, and return `[n / 3, base, fanEnd]`:

```ts
  for (let i = 0; i < oval.length; i++) tri(oc, 1, oval[i], 1, oval[(i + 1) % oval.length], 1);
  const fanEnd = n / 3;
  for (let i = 0; i < oval.length; i++) {
    const a = oval[i];
    const b = oval[(i + 1) % oval.length];
    const ao = away(a, oc, ring);
    const bo = away(b, oc, ring);
    tri(a, 1, b, 1, bo, 0);
    tri(a, 1, bo, 0, ao, 0);
  }
  const base = n / 3;
```

(return type `[number, number, number]`; doc: "fans [0, fanEnd), ring [fanEnd, base), holes [base, count)").

3. Replace the pass with:

```ts
export interface MaskFace {
  face: Face;
  weight: number;
  /** (kS, kR): this face's 磨皮 / 紅潤 relative to the frame maxima */
  k: readonly [number, number];
}

export interface MaskPass {
  /**
   * Clear `dst` (RGBA8, ¼ res) to `clear` = (gS, gR), then draw every face (S §4.2): all rings with MAX blending, all
   * oval fans with blending off (inside its own oval a face's strength always wins), all eye / mouth holes with MIN.
   * R = 磨皮 strength, G = 紅潤 strength.
   */
  drawFaces(dst: Framebuffer, faces: readonly MaskFace[], clear: readonly [number, number]): void;
  /** one face, v0.3's mask in both channels: 1 − w outside, 1 − w + w·m inside */
  draw(dst: Framebuffer, face: Face, faceWeight: number): void;
  /** fill both channels with `value` (harness) */
  fill(dst: Framebuffer, value: number): void;
  dispose(): void;
}

export function createMaskPass(gl: GL): MaskPass {
  const prog: Program = createProgram(gl, MASK_VS, MASK_FS, 'mask');
  const vao = gl.createVertexArray();
  const buf = gl.createBuffer();
  let verts = new Float32Array(MASK_MAX_FLOATS);
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  let bufBytes = verts.byteLength;
  gl.bufferData(gl.ARRAY_BUFFER, bufBytes, gl.DYNAMIC_DRAW);
  const aPos = gl.getAttribLocation(prog.program, 'aPos');
  const aVal = gl.getAttribLocation(prog.program, 'aVal');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 12, 0);
  gl.enableVertexAttribArray(aVal);
  gl.vertexAttribPointer(aVal, 1, gl.FLOAT, false, 12, 8);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  const clearTo = (dst: Framebuffer, c: readonly [number, number]) => {
    bindTarget(gl, dst);
    gl.clearColor(c[0], c[1], 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.clearColor(0, 0, 0, 0);
  };
  const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

  const drawFaces: MaskPass['drawFaces'] = (dst, faces, clear) => {
    const g: [number, number] = [clamp01(clear[0]), clamp01(clear[1])];
    clearTo(dst, g);
    const list = faces.filter((f) => f.face.oval.length >= 6);
    if (!list.length) return;
    const need = list.reduce((s, f) => s + ((f.face.oval.length / 2) * 3 + (6 + 6 + 12) * 3) * 9, 0);
    if (need > verts.length) verts = new Float32Array(need);
    const segs: { start: number; count: number; base: number; fanEnd: number; wk: [number, number] }[] = [];
    let at = 0;
    const aspect = dst.width / dst.height;
    for (const f of list) {
      const w = clamp01(f.weight);
      const [count, base, fanEnd] = buildMaskGeometry(f.face, aspect, verts.subarray(at * 3));
      segs.push({ start: at, count, base, fanEnd, wk: [w * clamp01(f.k[0]), w * clamp01(f.k[1])] });
      at += count;
    }
    prog.use();
    gl.uniform2f(prog.u('uG'), g[0], g[1]);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    if (verts.byteLength > bufBytes) {
      bufBytes = verts.byteLength;
      gl.bufferData(gl.ARRAY_BUFFER, bufBytes, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts, 0, at * 3);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.disable(gl.CULL_FACE);
    const each = (from: (s: (typeof segs)[number]) => number, to: (s: (typeof segs)[number]) => number) => {
      for (const s of segs) {
        gl.uniform2f(prog.u('uWK'), s.wk[0], s.wk[1]);
        gl.drawArrays(gl.TRIANGLES, s.start + from(s), to(s) - from(s));
      }
    };
    // 1. rings take the larger strength where they overlap
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.MAX);
    each((s) => s.fanEnd, (s) => s.base);
    // 2. fans overwrite: inside its own oval each face writes its own strength (a neighbour's ring never lifts it)
    gl.disable(gl.BLEND);
    each(() => 0, (s) => s.fanEnd);
    // 3. holes only ever lower the mask
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.MIN);
    each((s) => s.base, (s) => s.count);
    gl.blendEquation(gl.FUNC_ADD);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  };

  return {
    drawFaces,
    draw(dst, face, faceWeight) {
      const w = clamp01(faceWeight);
      drawFaces(dst, w > 0 ? [{ face, weight: w, k: [1, 1] }] : [], [1 - w, 1 - w]);
    },
    fill(dst, value) {
      clearTo(dst, [value, value]);
    },
    dispose() {
      prog.dispose();
      gl.deleteVertexArray(vao);
      gl.deleteBuffer(buf);
    },
  };
}
```

`buildMaskGeometry(face, aspect, out)` writes into `out` from index 0, which is why the segment loop passes `verts.subarray(at * 3)`.

- [x] **Step 4: Makeup per face (`src/engine/passes/makeup.ts`, CRLF)**

1. Add (keep the v1 `makeupUniforms`):

```ts
/** one person's makeup uniforms at a face weight (S §4.3) */
export function makeupUniformsFor(person: PersonParams, weight: number): MakeupUniforms {
  const w = clamp01(weight);
  const lipHex = shadeColor('lip', person.shades.lip);
  const blushHex = shadeColor('blush', person.shades.blush);
  return {
    lip: clamp01(person.values['makeup.lip']) * w,
    blush: clamp01(person.values['makeup.blush']) * w,
    lipColor: lipHex ? hexToRgb(lipHex) : null,
    blushColor: blushHex ? hexToRgb(blushHex) : null,
  };
}
```

2. `MESH_FS`, last line of `main`:

```glsl
  vec3 m = mix(vec3(1.0), lipMul, uLipI) * mix(vec3(1.0), blushMul, uBlushI * vBlushFade);
  // a fragment without makeup keeps the copy (= src) bit for bit, so a later face's mesh never erases an earlier
  // face's lip or blush where the later face has none (S §4.3)
  if (all(greaterThanEqual(m, vec3(0.999)))) discard;
  outColor = vec4(base * m, 1.0);
```

3. `MakeupPass` gains `/** one copy of src, then one mesh per face whose makeup is active, each reading src (S §4.3) */ drawFaces(src: Texture, dst: Framebuffer, faces: readonly { face: Face; u: MakeupUniforms }[]): void;`. In `createMakeupPass`, replace the returned `draw` (`:191-224`) with:

```ts
  const drawFaces: MakeupPass['drawFaces'] = (src, dst, faces) => {
    bindTarget(gl, dst);
    gl.disable(gl.BLEND);
    copy.use();
    bindTexture(gl, 0, src);
    drawFullscreen(gl);
    if (!tex) return;
    let drew = false;
    for (const { face, u } of faces) {
      if (!makeupActive(u)) continue;
      drew = true;
      const p = face.pts111;
      for (let i = 0; i < 222; i++) pos[i] = p[i] * 2 - 1;
      mesh.use();
      gl.uniform2f(mesh.u('uInvDst'), 1 / dst.width, 1 / dst.height);
      gl.uniform1f(mesh.u('uLipI'), clamp01(u.lip));
      gl.uniform1f(mesh.u('uBlushI'), clamp01(u.blush));
      gl.uniform1i(mesh.u('uLipTint'), u.lipColor ? 1 : 0);
      gl.uniform1i(mesh.u('uBlushTint'), u.blushColor ? 1 : 0);
      gl.uniform3fv(mesh.u('uLipShade'), u.lipColor ?? [1, 1, 1]);
      gl.uniform3fv(mesh.u('uBlushShade'), u.blushColor ?? [1, 1, 1]);
      bindTexture(gl, 1, tex.lip);
      bindTexture(gl, 2, tex.lipMask);
      bindTexture(gl, 3, tex.blush);
      bindTexture(gl, 4, tex.blushMask);
      bindTexture(gl, 0, src);

      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      // No culling: four template triangles have zero area and flip harmlessly (RB §2.5).
      gl.disable(gl.CULL_FACE);
      gl.drawElements(gl.TRIANGLES, FACE_INDICES.length, gl.UNSIGNED_SHORT, 0);
      gl.bindVertexArray(null);
    }
    if (drew) gl.activeTexture(gl.TEXTURE0);
  };
```

declared just before the `return {`; in the returned object the `draw` method becomes `draw(src, dst, face, u) { drawFaces(src, dst, [{ face, u }]); },`, `drawFaces,` is added after `ready,`, and `dispose` stays exactly as it is.

- [x] **Step 5: Composite per-pixel gates (`src/engine/shaders/composite.ts:166-194`)**

```glsl
  // Smoothing (GLES gate is blurAlpha >= 0.0, so it always runs; k = 0 when uSmooth = 0). Per-pixel strengths
  // (S §4.5): R = 磨皮, G = 紅潤 of the (warped) skin mask; the white stand-in gives today's all-skin path.
  vec4 mk = texture(uMask, vUv);
  float ramp = clamp((min(I.r, Mn.r - 0.1) - 0.2) * 4.0, 0.0, 1.0);
  float pS = ramp * mix(1.0, mk.r, uMaskOn);
  float pR = ramp * mix(1.0, mk.g, uMaskOn);
  float meanVar = (V.r + V.g + V.b) / 3.0;
  float kMin = clamp((1.0 - meanVar / (meanVar + theta)) * pS * uSmooth, 0.0, 1.0);
```

and in the 紅潤 block `uRosy * p` → `uRosy * pR`. Nothing else changes.

- [x] **Step 6: Pipeline and engine**

`src/engine/pipeline.ts` (CRLF):
1. Imports: `FACE_TABLE_CARRIER` (`../config/limits`), `attenuate, capsFor, faceDrawn, WHOLE, type TableFace` (`./passes/faceCap`), `makeupUniformsFor` is not needed here; types `FaceProtect, PhotoParams`.
2. Replace `FrameJob` (`:53-75`) with:

```ts
export interface FrameFace {
  face: Face;
  /** 0..1 (live easing; 1 in the editor) */
  weight: number;
  /** × weight, not yet yaw-attenuated (tableFaces attenuates, like ReshapePass.draw did) */
  reshape: ReshapeUniforms;
  /** × weight */
  makeup: MakeupUniforms;
  /** this face's 磨皮 / 紅潤 relative to the frame maxima (skinMaxima) */
  kS: number;
  kR: number;
  protect: FaceProtect | null;
  /** oval-bbox centre (UV): the caps */
  centre: [number, number];
  /** camera: the track's presence easer for its neighbours' caps; 1 otherwise */
  presence: number;
}

export interface FrameJob {
  src: Texture;
  size: Size;
  halfMean: boolean;
  /** ≤ MAX_RENDER_FACES, in table order */
  faces: FrameFace[];
  /** box centres of faces that get no effects but bound the caps */
  obstacles: readonly (readonly [number, number])[];
  /** skin-mask clear (gS, gR) */
  maskClear: [number, number];
  body: BodyField | null;
  photo: PhotoParams;
  skin: SkinUniforms;
  luts: StaticLuts | null;
  filterLut: Texture | null;
  matchGpupixel: boolean;
  target: 'canvas' | 'fbo';
  mirror: boolean;
}
```

3. `PassPlanInput`: replace `hasFace: boolean; faceWeight: number;` with `/** some listed face has weight > 0 */ anyFace: boolean;`; `planPasses`: `const faceOn = i.anyFace;` (rest unchanged).
4. Add:

```ts
const ZERO_U: ReshapeUniforms = { faceSlim: 0, faceV: 0, faceNarrow: 0, chin: 0, forehead: 0, noseSlim: 0, mouthSize: 0, eyeDistance: 0, eyeEnlarge: 0 };

/** The face table of a frame (S §4.1): caps over every listed face and obstacle; a layer per drawn face with a limit. */
export function tableFaces(job: Pick<FrameJob, 'faces' | 'obstacles'>, aspect: number): { faces: TableFace[]; protects: FaceProtect[] } {
  const caps = capsFor(job.faces.map((f) => f.centre), job.obstacles, aspect, job.faces.map((f) => f.presence));
  const protects: FaceProtect[] = [];
  const faces = job.faces.map((f, i): TableFace => {
    // as v0.3: a face warps only with weight and an active warp; its limit only matters with a contour warp drawn
    const u = f.weight > 0 && reshapeActive(f.reshape) ? attenuate(f.reshape, f.face.yaw) : ZERO_U;
    let layer = -1;
    if (faceDrawn(u) && f.protect && faceProtectValid(f.protect)) {
      layer = protects.length;
      protects.push(f.protect);
    }
    return { face: f.face, u, layer, window: f.protect?.window ?? WHOLE, centre: f.centre, cap: caps[i] };
  });
  return { faces, protects };
}
```

5. `run(job)` (`:360-424`): replace the face handling with:

```ts
      const live = job.faces.filter((f) => f.weight > 0);
      const meshes = live.filter((f) => makeupActive(f.makeup)).map((f) => ({ face: f.face, u: f.makeup }));
      if (meshes.length) getMakeup();
      const body = bodyTexture(job.body);
      const plan = planPasses({
        anyFace: live.length > 0,
        matchGpupixel: job.matchGpupixel,
        skin: job.skin,
        makeupActive: meshes.length > 0,
        makeupReady,
        reshapeActive: live.some((f) => reshapeActive(f.reshape)),
        bodyOn: body !== null,
      });

      let maskTex: Texture | null = null;
      if (plan.mask) {
        mask ??= createMaskPass(gl);
        const m = fb('M', maskBufferSize(job.size));
        mask.drawFaces(m, job.faces.map((f) => ({ face: f.face, weight: f.weight, k: [f.kS, f.kR] as const })), job.maskClear);
        maskTex = m.tex;
        passes.push('mask');
      }

      let base: Texture = job.src;
      let baseFb: Framebuffer | null = null;
      if (plan.makeup && makeup) {
        const a = fb('A', job.size);
        makeup.drawFaces(base, a, meshes);
        base = a.tex;
        baseFb = a;
        passes.push('makeup');
      }
      if (plan.reshape) {
        reshape ??= createReshapePass(gl, { carrier: FACE_TABLE_CARRIER });
        const aspect = job.size.width / job.size.height;
        const t = tableFaces(job, aspect);
        const b = fb('B', job.size);
        reshape.drawFaces(base, b, t.faces, { aspect, body, protects: t.protects });
        base = b.tex;
        baseFb = b;
        passes.push('reshape');
        if (body) passes.push('body');
        if (maskTex) {
          // the mask is built from the detected landmarks but gates the warped image: the same backward map (every
          // face, its cap, the body field), at the image's aspect; all channels pass through
          const n = fb('N', maskBufferSize(job.size));
          reshape.drawFaces(maskTex, n, t.faces, { aspect, body, protects: t.protects });
          maskTex = n.tex;
          passes.push('maskWarp');
        }
      }
```

(The `gl.R8` format argument of `fb('M', …)` (`:385`) and `fb('N', …)` (`:419`) is gone: both use `fb`'s default `gl.RGBA8`, still 8-bit unorm per channel, so the 磨皮 channel quantizes exactly like v0.3's R8.) Update the header comment: `[P0 mask → RGBA8 ¼-res M (R 磨皮, G 紅潤 per face)]`. `drawOverlay(face, mirror)` keeps its signature.

`src/engine/index.ts` (CRLF): imports `MAX_RENDER_FACES` (`../config/limits`), `boxCentre, ovalBox` (`./passes/faceCap`), `makeupUniformsFor` (`./passes/makeup`), `reshapeUniforms` (`./passes/reshape`), `skinMaxima, skinUniformsFor` (`./uniforms`; drop `skinUniforms`), type `FrameFace`. Replace `job()` (`:174-194`) with:

```ts
  function job(input: RenderInput, src: Texture, size: Size, halfMean: boolean, target: FrameJob['target'], mirror: boolean): FrameJob {
    const filterLut = filterFor(input.photo.filterId);
    const listed = input.faces.slice(0, MAX_RENDER_FACES);
    const m = skinMaxima(
      listed.map((f) => ({ weight: f.weight, smooth: f.person.values['skin.smooth'], rosy: f.person.values['skin.rosy'] })),
      input.globalSkin,
    );
    const faces: FrameFace[] = listed.map((f, i) => {
      const w = Math.min(1, Math.max(0, Number.isFinite(f.weight) ? f.weight : 0));
      return {
        face: f.face,
        weight: w,
        reshape: reshapeUniforms(f.person.values, w),
        makeup: makeupUniformsFor(f.person, w),
        kS: m.k[i][0],
        kR: m.k[i][1],
        protect: f.protect,
        centre: boxCentre(ovalBox(f.face)),
        presence: f.presence ?? 1,
      };
    });
    return {
      src,
      size,
      halfMean,
      faces,
      obstacles: input.obstacles ?? [],
      maskClear: m.clear,
      // preview and export share this path, so the 美體 field and every face's limit apply identically to both
      body: input.body ?? null,
      photo: input.photo,
      skin: skinUniformsFor(input.photo, m.S, m.R, filterLut !== null),
      luts,
      filterLut,
      matchGpupixel: options.matchGpupixel,
      target,
      mirror,
    };
  }
```

and the overlay (`:228-231`): `if (options.showLandmarks && input.faces.length) { for (const f of input.faces) pipeline.drawOverlay(f.face, options.mirror); res.passes.push('overlay'); }`.

- [x] **Step 7: The still session (S1, `src/app/still.ts`)**

1. Imports: `EDIT_DETECT_FACES` (`../config/limits`), `adaptCached, prepareFaces` (`../detect/faces`); types `BodyField, CachedFace, CachedObstacle, Engine, Face, Rect, RenderInput, StillFrame, Tracker`.
2. Interfaces:

```ts
export interface SessionFace {
  id: string;
  face: Face;
  box: Rect;
  lm: Float32Array;
}

export interface StillSession {
  readonly width: number;
  readonly height: number;
  /** the selectable faces (cache order f0…), adapted at this bitmap's size */
  readonly faces: readonly SessionFace[];
  /** faces dropped by the size filter or the cap: no effects, they bound the caps */
  readonly obstacles: readonly CachedObstacle[];
  /** this session's detection drops (zeros when the faces were given) */
  readonly dropped: { tooSmall: number; overCap: number };
  /** false when the detector threw, so "no faces" is not a real answer */
  readonly faceKnown: boolean;
  /** schedule a render of `frame` (coalesced to one per animation frame) */
  render(frame: StillFrame): void;
  setCompare(on: boolean): void;
  setBody(field: BodyField | null): void;
  readonly body: BodyField | null;
  prepareExport(frame: StillFrame): Promise<void>;
  exportReady(frame: StillFrame): boolean;
  /** full-resolution export of `frame`, never mirrored; `body` omitted → the field set last */
  exportImageData(frame: StillFrame, body?: BodyField | null): ImageData;
  stopDisplay(): void;
  dispose(): void;
}

export interface StillSessionOptions {
  ownsBitmap?: boolean;
  /** faces already known for this bitmap (the cache, or the session a lost engine took along): no detection */
  faces?: readonly CachedFace[];
  obstacles?: readonly CachedObstacle[];
  body?: BodyField | null;
}
```

(keep the doc comments of the unchanged members).
3. In `createStillSession`: `const detected = opts.faces !== undefined ? fromCache(opts.faces, opts.obstacles ?? [], width, height) : detectOnce(tracker, bitmap, width, height);` then

```ts
  const dbg = debugState();
  if (dbg) {
    dbg.face = detected.faces.length > 0;
    dbg.faces = detected.faces.length;
    dbg.boxes = detected.faces.map((f) => ({ id: f.id, ...f.box }));
  }
```

`let params: BeautyParams | null` → `let frame: StillFrame | null`; drop `faceProtect`, `faceWeight`; `input(f: StillFrame, b = body): RenderInput => ({ source: bitmap, width, height, ...f, body: b })`; `render(f)`: `frame = f; ensureFilter(f.photo.filterId); schedule();`; in `flush`/`onRestored`/`prepare`/`exportReady`/`exportImageData` read `frame` / `f.photo.filterId` instead of `params` / `p.filterId`; remove `setFaceProtect` and the `faceProtect` getter; the returned object exposes `faces: detected.faces, obstacles: detected.obstacles, dropped: detected.dropped, faceKnown: detected.known`.
4. Replace `detectOnce` and add `fromCache`:

```ts
const NO_DROPS = { tooSmall: 0, overCap: 0 };

function fromCache(faces: readonly CachedFace[], obstacles: readonly CachedObstacle[], width: number, height: number) {
  return {
    faces: faces.map((c) => ({ id: c.id, face: adaptCached(c, width, height), box: c.box, lm: c.lm })),
    obstacles,
    dropped: NO_DROPS,
    known: true,
  };
}

function detectOnce(tracker: Tracker | null, bitmap: ImageBitmap, width: number, height: number) {
  if (!tracker) return { faces: [] as SessionFace[], obstacles: [] as CachedObstacle[], dropped: NO_DROPS, known: true };
  try {
    const lms = tracker.detectImage(bitmap, { maxFaces: EDIT_DETECT_FACES });
    const dbg = debugState();
    if (dbg) dbg.detectCalls++;
    const p = prepareFaces(lms, width, height);
    return { faces: p.faces, obstacles: p.obstacles, dropped: p.dropped, known: true };
  } catch (err) {
    reportError('still detect', err);
    return { faces: [] as SessionFace[], obstacles: [] as CachedObstacle[], dropped: NO_DROPS, known: false };
  }
}
```

`src/ui/editorModel.ts` `detectSession`: `S extends { faces: readonly unknown[]; faceKnown: boolean }` and `const unsure = hasTracker && s.faces.length === 0 && (!before || !healthy() || !s.faceKnown);`. In `editorModel.test.ts` the `session(face, known)` helper becomes `({ faces: face ? [face] : [], faceKnown: known })`.

- [x] **Step 8: The camera and the interim editor**

`src/app/live.ts` (CRLF): `import { legacyFrame } from '../edit/frame';`; `draw()` (`:176-179`): `else engine.render({ source: video, width: w, height: h, ...legacyFrame(params, shown, shown ? weight : 0) });`; `capture()` (`:326-336`): `engine.renderToImageData({ source: video, width: video.videoWidth, height: video.videoHeight, ...legacyFrame(deps.getParams(), shown, shown ? weight : 0) }, { mirror: … })`.

`src/ui/screens/Editor.tsx` (interim until Task 21; exact edits):
1. Imports: `legacyFrame` (`../../edit/frame`), `boxScore` (`../../detect/cache`); types `CachedFace, CachedObstacle, FaceProtect`.
2. `knownFace` (`:87`) → `const knownFaces = useRef<{ faces: CachedFace[]; obstacles: CachedObstacle[] } | undefined>(undefined);`.
3. Session creation (`:222-245`): `const known = tracker ? knownFaces.current : undefined;` and `deps.createStillSession(target, tracker, source.bitmap, { ownsBitmap: false, faces: known?.faces, obstacles: known?.obstacles, body: fieldMemo.field })`; after it: `if (s.faces.length && knownFaces.current === undefined && replacing) { fresh.current = null; saved.current = null; } knownFaces.current = { faces: s.faces.map((f) => ({ id: f.id, lm: f.lm, box: f.box })), obstacles: [...s.obstacles] };` (inside `if (tracker && !unsure)`); the toast: `if (tracker && !s.faces.length) toast(…)`.
4. Below `const session = …` add:

```tsx
  /** sub-step 1c interim: the engine draws the projection on the largest, most central face (Task 21 draws every person) */
  const primaryFace = useMemo(() => {
    const fs = session?.faces ?? [];
    return fs.length ? fs.reduce((a, b) => (boxScore(b.box) > boxScore(a.box) ? b : a)).face : null;
  }, [session]);
  const primaryFaceRef = useRef(primaryFace);
  primaryFaceRef.current = primaryFace;
  const [protect, setProtect] = useState<FaceProtect | null>(null);
  const protectRef = useRef(protect);
  protectRef.current = protect;
  const frameOf = (p: BeautyParams) => legacyFrame(p, primaryFaceRef.current, primaryFaceRef.current ? 1 : 0, protectRef.current);
```

5. `bodyFace` (`:480-482`): `const bodyFace = session ? primaryFace : bodyFaceRef.current;`.
6. `limitRecord` (`:284`): `protectSrc.record(protectRef.current)`.
7. Protect effect (`:584-598`; the session no longer holds the limit, the frame carries it):

```tsx
  useEffect(() => {
    if (!session) return;
    const bodyMask = bodyDet.phase === 'done' ? (bodyDet.det?.mask ?? null) : null;
    const p = protectSrc.update(primaryFace, contourActive(params), bodyMask, limitRequested);
    if (protectRef.current === p) return;
    protectRef.current = p;
    setProtect(p);
    // what an export is made from changed: re-arm the encode / autosave like a new 美體 field
    fieldGen.current++;
    setFieldTick((n) => n + 1);
  }, [session, bodyDet, params, protectTick, limitRequested, primaryFace]);
```

The session-creation options lose `faceProtect: protectSrc.protect` (`:234`).
8. Render effect: `session.render(frameOf(params))`, dependencies `[session, params, protect, primaryFace]`.
9. `encode(s, p, field)`: `await s.prepareExport(frameOf(p)); … s.exportImageData(frameOf(p), field)`. Every other `s.exportReady(p)` / `s.prepareExport(params)` / `s.exportImageData(params, field)` / `s.exportImageData(p, field)` in `flushHistory` and the encode effect wraps its params in `frameOf(…)`.
10. `faceNote` (`:790`): `if (session && !session.faces.length)`.

- [x] **Step 9: Port tests, pages and harnesses (mechanical)**

`src/app/testFakes.ts` (CRLF), append:

```ts
/** the one face a v0.3-style render input carried (legacyFrame), or null */
export const faceOf = (i: RenderInput | undefined): Face | null => i?.faces[0]?.face ?? null;
/** its weight (0 without a face) */
export const weightOf = (i: RenderInput | undefined): number => i?.faces[0]?.weight ?? 0;
```

Rules, applied to every file listed under **Files** above:
- An object literal used as `RenderInput` with `face: F, faceWeight: W, params: P` (and optionally `faceProtect: X`) becomes `...legacyFrame(P, F, W)` (`legacyFrame(P, F, W, X)`), importing `legacyFrame` from `src/edit/frame`. This covers `src/engine/index.test.ts:78, 91, 101-110`, `tests/e2e/pages/engine.ts` (`input`), `tests/e2e/pages/parity.ts` (`onFace` → `...legacyFrame(params, f, 1)`; the body case → `...legacyFrame(bodyParams, null, 0), body: field`), `tests/e2e/pages/faceProtect.ts:224`, `tests/harness/t1/harness.ts`, `tests/harness/b2/harness.ts:215-222`, `tests/harness/t7/fakes.ts:191, 208, 226`.
- `x.face` / `x.faceWeight` read from a `RenderInput` (`engine.lastInput()!.face`, `c[0].faceWeight`, …) become `faceOf(x)` / `weightOf(x)` (`src/app/live.test.ts`, `src/app/still.test.ts`).
- `toMatchObject({ …, faceWeight: N, params: P })` on a render input becomes `toMatchObject({ … })` plus `expect(weightOf(input)).toBe(N)` and `expect(input.photo).toEqual(splitLegacy(P).photo)`.
- A still session rendered or exported with BeautyParams `P` now gets `legacyFrame(P, s.faces[0]?.face ?? null, 1)`; `s.face` becomes `s.faces[0]?.face ?? null`; `{ face: X }` session options become `{ faces: X ? [{ id: 'f0', lm: makeLandmarks().points, box: { x: 0.3, y: 0.3, w: 0.4, h: 0.4 } }] : [] }` and an identity assertion `expect(s.face).toBe(known)` becomes `expect(s.faces).toHaveLength(1)` (the face is re-adapted from the cached landmarks).
- `src/app/still.test.ts`: the two `setFaceProtect` tests (`:442-480`) are replaced (A6 removes the API) by:

```ts
  it('each face of the frame carries its 瘦臉 limit to every render and export (A6)', () => {
    const engine = fakeEngine();
    const s = createStillSession(engine, fakeTracker(), bitmap());
    const prot = { width: 2, height: 2, data: new Float32Array(4), version: 1 };
    const frame = legacyFrame(natural, s.faces[0].face, 1, prot);
    s.render(frame);
    vi.advanceTimersByTime(16);
    expect(engine.lastInput()!.faces[0].protect).toBe(prot);
    s.exportImageData(frame);
    expect(engine.renderToImageData.mock.calls[0][0].faces[0].protect).toBe(prot);
  });
```

and `:36` becomes `toHaveBeenCalledWith(bmp, { maxFaces: EDIT_DETECT_FACES })`.
- `src/bench/main.ts` (CRLF) `runStill` (`:445-470`): `still.render(legacyFrame(params, still.faces[0]?.face ?? null, 1))`, the export loop the same, `still.face ? '✓' : '✗'` → `still.faces.length ? '✓' : '✗'`; the 特徵點 button's redraw (`:195`) `still.render(params)` → the same `legacyFrame(…)` call.
- `tests/harness/t8/still-main.ts`: `out.face = session.faces.length > 0; out.yaw = session.faces[0]?.face.yaw ?? null;`, renders/exports through `legacyFrame(glow, session.faces[0]?.face ?? null, 1)` / `legacyFrame(applyPreset('original'), …)`.
- `tests/harness/t7/fakes.ts` `fakeStill` (`:215-273`), the UI harness's still session, follows S1: `opts` gains `faces?: readonly CachedFace[]; obstacles?: readonly CachedObstacle[]`; `let last: StillFrame | null`; `const input = (f: StillFrame) => ({ source: bitmap, width: bitmap.width, height: bitmap.height, ...f });`; the `face:` property becomes `faces: flag('face') === '0' ? [] : [{ id: 'f0', face: { pts111: new Float32Array(222).fill(0.5), ext: new Float32Array(16).fill(0.5), oval: new Float32Array(72).fill(0.5), yaw: 0 }, box: { x: 0.3, y: 0.3, w: 0.4, h: 0.4 }, lm: new Float32Array(1434).fill(0.5) }],` followed by `obstacles: [], dropped: { tooSmall: 0, overCap: 0 },`; delete the `faceProtect` local, its getter and `setFaceProtect`; `prepareExport: (f) => (f.photo.filterId === 'none' ? Promise.resolve() : engine.loadFilter(f.photo.filterId).catch(() => undefined))`; `exportImageData: (f) => engine.renderToImageData(input(f), { mirror: false })`. Its fake live loop (`:191, :208`) renders `...legacyFrame(d.getParams(), null, 1)` (Task 25 moves it to the look). Imports: `legacyFrame` (`../../../src/edit/frame`), types `CachedFace, CachedObstacle, StillFrame`; drop `FaceProtect` and `BeautyParams` if unused.
- `tests/harness/b2/harness.ts`: its check 1 compares with the generated pre-美體 engine copy, whose `RenderInput` is v0.3's; mark that check `skipped (pre-v0.4 baseline)` in its `check()` list (`check('1. …', true, 'skipped: the baseline engine predates RenderInput v0.4 (tests/e2e/parity.spec.ts covers single-face identity)')`) and delete the stale `tests/harness/b2/baseline/` directory if it exists.

- [x] **Step 10: E2E engine harness for N faces (`tests/e2e/pages/engine.ts`, `tests/e2e/engine.spec.ts`)**

Add to `engine.ts`:

```ts
declare global {
  interface Window {
    runEngineMulti?: () => Promise<{ maskA: number; maskB: number; maskBBorder: number; lipA: number; lipASolo: number }>;
  }
}

window.runEngineMulti = async () => {
  // two copies of the fixture face side by side: A at 自然 with a rose lip, B neutral; B's mesh must not erase A's lip,
  // and B's skin must not be smoothed (others untouched, S §4.2/§4.3)
  const blob = await (await fetch('/tests/fixtures/group_faces.png')).blob();
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const j = (await (await fetch('/tests/fixtures/group_faces.landmarks.json')).json()) as { width: number; height: number; faces: number[][] };
  const prepared = prepareFaces(j.faces.map((f) => ({ points: new Float32Array(f) })), j.width, j.height);
  const [A, B] = prepared.faces;
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const engine = createEngine(canvas, { mirror: false });
  await engine.ready;
  const lipPerson = { ...splitLegacy(setShade(applyPreset('natural', 1), 'lip', 'rose')).person };
  const frame = (faces: RenderFace[]): RenderInput => ({ source: bitmap, width: bitmap.width, height: bitmap.height, faces, globalSkin: null, photo: splitLegacy(applyPreset('original', 1)).photo });
  const both = engine.renderToImageData(frame([{ face: A.face, weight: 1, person: lipPerson, protect: null }, { face: B.face, weight: 1, person: neutralPerson(), protect: null }]), { mirror: false });
  const solo = engine.renderToImageData(frame([{ face: A.face, weight: 1, person: lipPerson, protect: null }]), { mirror: false });
  const orig = engine.renderToImageData(frame([]), { mirror: false });
  const mean = (img: ImageData, cx: number, cy: number, r = 3) => {
    let s = 0;
    let n = 0;
    for (let y = Math.round(cy * img.height) - r; y <= Math.round(cy * img.height) + r; y++)
      for (let x = Math.round(cx * img.width) - r; x <= Math.round(cx * img.width) + r; x++) {
        const i = (y * img.width + x) * 4;
        s += img.data[i];
        n++;
      }
    return s / n;
  };
  const P = A.face.pts111;
  const Q = B.face.pts111;
  // the lower lip: halfway between the outer lower-lip centre (93) and the inner one (102)
  const lip = [(P[93 * 2] + P[102 * 2]) / 2, (P[93 * 2 + 1] + P[102 * 2 + 1]) / 2] as const;
  const cheekB = [Q[7 * 2] + 0.01, Q[7 * 2 + 1]] as const;
  engine.dispose();
  bitmap.close();
  return {
    maskA: Math.abs(mean(both, P[7 * 2] + 0.01, P[7 * 2 + 1]) - mean(orig, P[7 * 2] + 0.01, P[7 * 2 + 1])),
    maskB: Math.abs(mean(both, cheekB[0], cheekB[1]) - mean(orig, cheekB[0], cheekB[1])),
    maskBBorder: Math.abs(mean(both, Q[0], Q[1]) - mean(orig, Q[0], Q[1])),
    lipA: Math.abs(mean(both, lip[0], lip[1]) - mean(orig, lip[0], lip[1])),
    lipASolo: Math.abs(mean(solo, lip[0], lip[1]) - mean(orig, lip[0], lip[1])),
  };
};
```

(imports: `prepareFaces` from `src/detect/faces`, `splitLegacy` from `src/edit/legacy`, `neutralPerson` from `src/edit/state`, `RenderFace` type.)

Append to `tests/e2e/engine.spec.ts`:

```ts
test('two faces: per-face skin strengths and makeup; the neutral face is untouched (S §4.2, §4.3)', async ({ page }) => {
  await page.goto(`${DEV_URL}/tests/e2e/pages/engine.html`);
  await page.waitForFunction(() => typeof window.runEngineMulti === 'function');
  const r = await page.evaluate(() => window.runEngineMulti!());
  console.log(JSON.stringify(r));
  expect(r.maskB).toBeLessThan(0.5);
  expect(r.maskBBorder).toBeLessThan(0.5);
  expect(r.lipA).toBeGreaterThan(3);
  expect(Math.abs(r.lipA - r.lipASolo)).toBeLessThan(0.5);
});
```

- [x] **Step 11: Run**

Run: `npx vitest run && npm run typecheck && npm run build`
Expected: all green.

Run: `npx playwright test tests/e2e/parity.spec.ts tests/e2e/engine.spec.ts tests/e2e/reshape.spec.ts tests/e2e/faceProtect.spec.ts tests/e2e/editor.spec.ts tests/e2e/camera.spec.ts tests/e2e/body.spec.ts`
Expected: PASS; parity max ≤ 1/255 (the per-face mask, the makeup discard and the face-table reshape keep one face within tolerance).

- [x] **Step 12: Commit**

```bash
git add -A src tests/e2e tests/harness
git commit -m "v0.4 step 1c: RenderInput v0.4 — every face through mask (RGBA8), makeup, reshape and composite"
```

---

### Task 19: The 瘦臉 limit per face (F1)

**Files:**
- Modify: `src/tracking/faceProtect.ts:100-145`, `src/tracking/faceProtect.test.ts` (append), `src/ui/faceProtectModel.ts:45-49,150-299`, `src/ui/faceProtectModel.test.ts` (append), `src/ui/screens/Editor.tsx` (`schedule`), `src/engine/passes/faceProtect.test.ts` (append), `tests/e2e/pages/reshape.ts`, `tests/e2e/faceProtect.spec.ts` (append), `src/bench/multiFace.ts` (row F)

**Interfaces:**
- Consumes: `uMaxBox`, `ovalBox`, `boxCentre` (Tasks 13, 16), `PROTECT_REACH` (`reshape.ts`), `PROTECT_WINDOW`, `distanceOutside` (`body/mask.ts`).
- Produces:

```ts
// src/tracking/faceProtect.ts
export interface ProtectRegions {
  /** this face's person: its paired pose mask, else the selfie mask; null = the oval alone */
  own: PersonMask | null;
  /** `own` is the shared selfie mask: clip it to this face's Voronoi cell */
  clipToCell: boolean;
  /** box centres (UV) of every other selectable face and every obstacle */
  otherCentres: readonly (readonly [number, number])[];
  /** ovals of every other selectable face and every obstacle */
  otherOvals: readonly Float32Array[];
  /** pose masks of the other body persons */
  otherMasks: readonly PersonMask[];
  /** null = the whole-photo grid (one selectable face); else this face's window (protectWindow) */
  window: Rect | null;
}
export function buildFaceProtect(face: Face, regions: ProtectRegions | PersonMask | null, width: number, height: number): FaceProtect;
export function protectWindow(face: Face, width: number, height: number): Rect;
// src/ui/faceProtectModel.ts
export function contourActiveValues(values: Readonly<Record<string, number>>): boolean;
export interface ProtectRequest {
  id: string;
  face: Face;
  /** this face's person draws a contour warp */
  contour: boolean;
  /** the paired body's pose mask (null: none) */
  pose: PersonMask | null;
  /** everything but own / clipToCell */
  others: Omit<ProtectRegions, 'own' | 'clipToCell'>;
}
FaceProtectSource.updateAll(requests: readonly ProtectRequest[], requested: boolean): ReadonlyMap<string, FaceProtect>;
FaceProtectSource.record(drawn: FaceProtect | ReadonlyMap<string, FaceProtect> | null): FaceProtectRecord;
FaceProtectDeps gains schedule(fn: () => void): void  // next animation frame; tests: run at once
```

`update(face, contour, bodyMask, requested)` and `protect` stay as the one-face form (the face is `'f0'`).

- [x] **Step 1: Characterize today's single-face limit (snapshot) — before touching the code**

Append to `src/tracking/faceProtect.test.ts`:

```ts
/** FNV-1a 32 of the float bits */
function bits(a: Float32Array): string {
  const u = new Uint32Array(a.buffer, a.byteOffset, a.length);
  let h = 0x811c9dc5;
  for (const x of u) {
    h ^= x;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

describe('single face is byte-equal to v0.3 (S §4.7 item 4)', () => {
  it('portrait with mask / without mask', () => {
    expect(bits(buildFaceProtect(pr.face, maskOf(pr.inside), W, H).data)).toMatchSnapshot();
    expect(bits(buildFaceProtect(pr.face, null, W, H).data)).toMatchSnapshot();
  });
});
```

Run: `npx vitest run src/tracking/faceProtect.test.ts`
Expected: PASS with `2 snapshots written` (today's code: this is the v0.3 reference). Commit the snapshot file with the task.

- [x] **Step 2: Failing tests for the regions**

Append to `src/tracking/faceProtect.test.ts`:

```ts
describe('buildFaceProtect with other persons (S §4.7)', () => {
  const twin = (dx: number) => {
    const f = pr.face;
    const m = (a: Float32Array) => a.map((v, i) => (i % 2 === 0 ? v + dx : v));
    return { pts111: m(f.pts111), ext: m(f.ext), oval: m(f.oval), yaw: 0 };
  };
  const B = twin(0.45);
  const P = pr.face.pts111;
  /** R_f = PROTECT_REACH (0.3) face widths, iso */
  const reach = 0.3 * Math.hypot(P[0] - P[64], ((P[1] - P[65]) * H) / W);
  const none = { otherCentres: [], otherOvals: [], otherMasks: [], window: null };
  // a test point half a reach right of the face oval (its own budget is clearly positive there), inside a disc
  // (radius one reach, iso) that stands for another person
  const right = Math.max(...Array.from({ length: 36 }, (_, i) => pr.face.oval[i * 2]));
  const row = P[46 * 2 + 1];
  const probe: [number, number] = [right + 0.5 * reach, row];
  const disc = { cx: right + 1.2 * reach, r: reach };
  const inDisc = (u: number, v: number) => Math.hypot(u - disc.cx, ((v - row) * H) / W) < disc.r;
  const discOval = new Float32Array(72).map((_, k) => {
    const a = (Math.floor(k / 2) / 36) * 2 * Math.PI;
    return k % 2 === 0 ? disc.cx + disc.r * Math.cos(a) : row + ((disc.r * W) / H) * Math.sin(a);
  });
  it('the same regions object without others is today’s limit', () => {
    const a = buildFaceProtect(pr.face, maskOf(pr.inside), W, H);
    const b = buildFaceProtect(pr.face, { own: maskOf(pr.inside), clipToCell: false, ...none }, W, H);
    expect(Array.from(b.data)).toEqual(Array.from(a.data));
  });
  it('another person’s mask or another face’s oval takes the budget to ≈ 0 next to them (S §4.7 item 2)', () => {
    const alone = buildFaceProtect(pr.face, null, W, H);
    expect(reach - at(alone, probe[0], probe[1])).toBeGreaterThan(0.3 * reach);
    const byMask = buildFaceProtect(pr.face, { own: null, clipToCell: false, ...none, otherCentres: [[disc.cx, row]], otherMasks: [maskOf((u, v) => (inDisc(u, v) ? 1 : 0))] }, W, H);
    const byOval = buildFaceProtect(pr.face, { own: null, clipToCell: false, ...none, otherCentres: [[disc.cx, row]], otherOvals: [discOval] }, W, H);
    // the three box blurs round the max(·) a little: ≤ 0 before them (A4), ≤ 0.25 R_f after
    expect(reach - at(byMask, probe[0], probe[1])).toBeLessThanOrEqual(0.25 * reach);
    expect(reach - at(byOval, probe[0], probe[1])).toBeLessThanOrEqual(0.25 * reach);
    expect(reach - at(byMask, disc.cx, row)).toBeLessThanOrEqual(0);
  });
  it('stays 1-Lipschitz with others (the wall-line bound, A4)', () => {
    const p = buildFaceProtect(pr.face, { own: null, clipToCell: false, otherCentres: [[0.95, 0.5]], otherOvals: [B.oval], otherMasks: [], window: null }, W, H);
    let worst = 0;
    for (let y = 0; y < p.height; y++)
      for (let x = 0; x + 1 < p.width; x++) worst = Math.max(worst, Math.abs(p.data[y * p.width + x + 1] - p.data[y * p.width + x]));
    expect(worst).toBeLessThanOrEqual((1 / p.width) * 1.0001);
  });
  it('a shared selfie mask is clipped to this face’s Voronoi cell', () => {
    const both = maskOf(() => 1);
    const cB: [number, number] = [0.95, P[46 * 2 + 1]];
    const p = buildFaceProtect(pr.face, { own: both, clipToCell: true, otherCentres: [cB], otherOvals: [], otherMasks: [], window: null }, W, H);
    expect(at(p, 0.97, 0.5)).toBeGreaterThan(0); // beyond the halfway line: not this person
    expect(at(p, P[46 * 2], P[46 * 2 + 1])).toBeLessThan(0);
  });
  it('≥ 2 faces: a PROTECT_WINDOW² window around the U_MAX box padded by R_f, square in iso units', () => {
    const win = protectWindow(pr.face, W, H);
    expect(win.w).toBeCloseTo((win.h * H) / W, 6);
    const p = buildFaceProtect(pr.face, { own: null, clipToCell: false, otherCentres: [[0.95, 0.5]], otherOvals: [], otherMasks: [], window: win }, W, H);
    expect([p.width, p.height]).toEqual([128, 128]);
    expect(p.window).toEqual(win);
  });
});
```

(import `protectWindow` from `./faceProtect`.)

Append to `src/ui/faceProtectModel.test.ts` (inside a new describe; reuse the file's `harness` helper):

```ts
describe('FaceProtectSource per face (F1)', () => {
  // ≥ 2 faces: the others are listed and each face has a window, so the regions form of build is used
  const others = { otherCentres: [[0.9, 0.5]] as [number, number][], otherOvals: [], otherMasks: [], window: { x: 0, y: 0, w: 0.5, h: 0.5 } };
  const req = (id: string, f: Face, contour: boolean, pose: PersonMask) => ({ id, face: f, contour, pose, others });
  it('builds only the faces whose person draws a contour warp, at most one per call; the rest follow on schedule', () => {
    const h = harness();
    const [A, B, m] = [face(), face(), mask()];
    const r1 = h.src.updateAll([req('f0', A, true, m), req('f1', B, true, m)], true);
    expect(r1.size).toBe(1);
    expect(h.built).toHaveLength(1);
    expect(h.deps.schedule).toHaveBeenCalledTimes(1);
    expect(h.changed).toHaveBeenCalledTimes(1); // the fake schedule runs at once: the editor calls updateAll again
    const r2 = h.src.updateAll([req('f0', A, true, m), req('f1', B, true, m)], true);
    expect(r2.size).toBe(2);
    expect(h.built).toHaveLength(2);
    expect(h.src.updateAll([req('f0', A, true, m), req('f1', B, false, m)], true).size).toBe(2); // kept once built
    expect(h.built).toHaveLength(2);
  });
  it('a contour edit on person 2 builds only f1; repeating the same requests rebuilds nothing', () => {
    const h = harness();
    const [A, B, m] = [face(), face(), mask()];
    h.src.updateAll([req('f0', A, false, m), req('f1', B, true, m)], true);
    expect(h.built).toHaveLength(1);
    h.src.updateAll([req('f0', A, false, m), req('f1', B, true, m)], true);
    expect(h.built).toHaveLength(1);
  });
  it('record stays photo-level: requested and drawn → true with any limit', () => {
    const h = harness();
    const drawn = h.src.updateAll([req('f0', face(), true, mask())], true);
    expect(h.src.record(drawn).faceProtect).toBe(true);
  });
});
```

In the file's `harness()` (`:27-47`) add `schedule: vi.fn((fn: () => void) => fn()),` to `deps`; its `build` mock keeps its `(f: Face, m: PersonMask)` parameter list (the regions form only reaches it in the tests above, which count calls).

Run: `npx vitest run src/tracking/faceProtect.test.ts src/ui/faceProtectModel.test.ts`
Expected: FAIL (`protectWindow` / `updateAll` missing).

- [x] **Step 3: Implement the regions (`src/tracking/faceProtect.ts`)**

Imports: `PROTECT_WINDOW` (`../config/limits`), `PROTECT_REACH` (`../engine/passes/reshape`), `ovalBox, uMaxBox` (`../engine/passes/faceCap`), `Rect` type. Replace `buildFaceProtect` (`:102-145`) with:

```ts
export interface ProtectRegions {
  own: PersonMask | null;
  clipToCell: boolean;
  otherCentres: readonly (readonly [number, number])[];
  otherOvals: readonly Float32Array[];
  otherMasks: readonly PersonMask[];
  window: Rect | null;
}

const isRegions = (r: ProtectRegions | PersonMask | null): r is ProtectRegions => !!r && 'clipToCell' in r;

/**
 * The window of a face's limit with ≥ 2 selectable faces (S §4.7 item 5): the square, in iso units, around its U_MAX
 * influence box padded by R_f = PROTECT_REACH · fw, so the chain only ever samples inside it.
 */
export function protectWindow(face: Face, width: number, height: number): Rect {
  const aspect = width / Math.max(1, height);
  const b = uMaxBox(face, aspect);
  const P = face.pts111;
  const R = PROTECT_REACH * Math.hypot(P[0] - P[64], (P[1] - P[65]) / aspect);
  const x0 = b[0] - R;
  const x1 = b[2] + R;
  const y0 = b[1] / aspect - R;
  const y1 = b[3] / aspect + R;
  const s = Math.max(x1 - x0, y1 - y0);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return { x: cx - s / 2, y: (cy - s / 2) * aspect, w: s, h: s * aspect };
}

/**
 * The distance grid for `face`: per texel the signed distance (iso units) from the texel centre to the face's person,
 * negative inside, clamped to ±SD_CLAMP. `regions` (or, as before, just the person mask): the own region is the mask
 * (∩ the face's Voronoi cell for a shared selfie mask) ∪ the oval, connected to the oval; every other face, obstacle and
 * person counts as infinitely far: sd_raw = max(sd_own_raw, R_f − d_others) before the three box blurs, so the budget
 * is ≤ 0 inside them and the result stays 1-Lipschitz and crease-free (A4). Without others: today's grid, byte-equal.
 */
export function buildFaceProtect(face: Face, regions: ProtectRegions | PersonMask | null, width: number, height: number): FaceProtect {
  const r: ProtectRegions = isRegions(regions) ? regions : { own: regions, clipToCell: false, otherCentres: [], otherOvals: [], otherMasks: [], window: null };
  const win = r.window ?? { x: 0, y: 0, w: 1, h: 1 };
  const [w, h] = r.window ? [PROTECT_WINDOW, PROTECT_WINDOW] : protectGridSize(width, height);
  const aspect = width / Math.max(1, height);
  const uvOf = (x: number, y: number): [number, number] => [win.x + ((x + 0.5) / w) * win.w, win.y + ((y + 0.5) / h) * win.h];
  const ob = ovalBox(face);
  const own: [number, number] = [ob.x + ob.w / 2, ob.y + ob.h / 2];
  const iso2 = (a: readonly [number, number], b: readonly [number, number]) => (a[0] - b[0]) ** 2 + ((a[1] - b[1]) / aspect) ** 2;
  const inCell = (p: [number, number]) => r.otherCentres.every((c) => iso2(p, own) <= iso2(p, c));
  const inside = new Uint8Array(w * h);
  const inOval = new Uint8Array(w * h);
  const others = new Uint8Array(w * h);
  const oval = face.oval;
  const nOval = oval.length / 2;
  let anyOther = false;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [u, v] = uvOf(x, y);
      const i = y * w + x;
      inOval[i] = inPolygon(oval, nOval, u, v) ? 1 : 0;
      const m = r.own !== null && maskAt(r.own, u, v) >= 0.5;
      const cellOk = !r.clipToCell || inCell([u, v]);
      inside[i] = inOval[i] || (m && cellOk) ? 1 : 0;
      if (inOval[i]) continue;
      const o =
        (m && !cellOk) ||
        r.otherOvals.some((ov) => inPolygon(ov, ov.length / 2, u, v)) ||
        r.otherMasks.some((om) => maskAt(om, u, v) >= 0.5);
      if (o) {
        others[i] = 1;
        anyOther = true;
      }
    }
  }
  // only this face's person: another person, or a false positive of the segmenter, must not carry the face's warp
  keepConnected(inside, inOval, w, h);
  const outside = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) outside[i] = 1 - inside[i];
  const dOut = distanceOutside(inside, w, h); // texels to the nearest person texel (0 inside)
  const dIn = distanceOutside(outside, w, h); // texels to the nearest background texel (0 outside)
  const texel = win.w / w; // iso length of one texel (the grid is square in iso units)
  const sd = new Float32Array(w * h);
  const anyIn = inside.some((b) => b === 1);
  const anyOut = outside.some((b) => b === 1);
  for (let i = 0; i < w * h; i++) {
    // the boundary lies half a texel from the centres on either side of it
    if (!anyOut) sd[i] = -SD_CLAMP; // nothing but person: nothing to protect
    else if (!anyIn) sd[i] = SD_CLAMP;
    else sd[i] = (inside[i] ? -(dIn[i] - 0.5) : dOut[i] - 0.5) * texel;
  }
  const P = face.pts111;
  const fwIso = Math.hypot(P[0] - P[64], (P[1] - P[65]) / aspect);
  if (anyOther) {
    // other persons count as infinitely far: their budget R_f − sd ≤ 0 (A4), applied to the raw distance
    const dO = distanceOutside(others, w, h);
    const R = PROTECT_REACH * fwIso;
    for (let i = 0; i < w * h; i++) sd[i] = Math.max(sd[i], R - dO[i] * texel);
  }
  // smooth the medial-axis kinks and the mask's stair steps over ≈ SMOOTH_FW face widths (3 box passes ≈ a Gaussian);
  // the photo grid keeps v0.3's expression bit for bit
  const fwTexels = r.window ? fwIso / texel : Math.hypot(P[0] - P[64], ((P[1] - P[65]) * height) / Math.max(1, width)) * w;
  const rad = Math.max(1, Math.round(SMOOTH_FW * fwTexels));
  for (let k = 0; k < 3; k++) boxBlur(sd, w, h, rad);
  for (let i = 0; i < w * h; i++) sd[i] = Math.max(-SD_CLAMP, Math.min(SD_CLAMP, sd[i]));
  return { width: w, height: h, data: sd, version: ++versions, ...(r.window ? { window: win } : {}) };
}
```

Byte-equality without others and without a window: `uvOf` gives `0 + ((x + 0.5) / w) · 1` (exact), `texel = 1 / w`, the others pass is skipped and `fwTexels` is today's expression, so the Step 1 snapshots must still match.

- [x] **Step 4: Per-face source (`src/ui/faceProtectModel.ts`)**

1. `contourActive` keeps its signature; add

```ts
/** a contour warp is drawn with these person values */
export function contourActiveValues(values: Readonly<Record<string, number>>): boolean {
  const u = reshapeUniforms(values as Record<ParamId, number>, 1);
  return Object.values(CONTOUR).some((k) => u[k] !== 0);
}
```

and make `contourActive(p)` return `contourActiveValues(p.values)`.
2. `FaceProtectDeps`: `build(face: Face, mask: PersonMask | ProtectRegions): FaceProtect;` (method syntax, so the existing test harness's `(f: Face, m: PersonMask)` mock still satisfies it; the Editor's `(face, mask) => buildFaceProtect(face, mask, photo.width, photo.height)` already accepts both); add `/** run fn on the next animation frame (tests: at once) */ schedule(fn: () => void): void;`. Import `type ProtectRegions` from `../tracking/faceProtect`.
3. Replace the single `cur` with a per-face memo and add `updateAll`; keep `update` and `protect` as the one-face form:

```ts
interface Entry {
  face: Face;
  mask: PersonMask | null;
  othersKey: string;
  protect: FaceProtect;
}
const ids = new WeakMap<object, number>();
let nextId = 0;
const idOf = (o: object) => {
  let v = ids.get(o);
  if (v === undefined) ids.set(o, (v = ++nextId));
  return v;
};
const othersKeyOf = (o: ProtectRequest['others']) =>
  JSON.stringify([o.otherCentres, o.otherOvals.map(idOf), o.otherMasks.map(idOf), o.window]);
```

and in the class (replacing `cur` and `bodyOk`):

```ts
  private entries = new Map<string, Entry>();
  private bodyOk = new Map<string, { face: Face; mask: PersonMask; ok: boolean }>();
  private scheduled = false;

  /**
   * Bring every face's limit up to date (F1). A limit is built only for a face whose person draws a contour warp and
   * kept once built; the own region is the paired pose mask when it covers the face, else the selfie mask clipped to
   * the face's cell when other faces exist. At most ONE build per call: the rest follow on deps.schedule (one per
   * animation frame), and a face whose limit is pending renders without it meanwhile.
   */
  updateAll(requests: readonly ProtectRequest[], requested: boolean): ReadonlyMap<string, FaceProtect> {
    if (requested) this.asked = true;
    const out = new Map<string, FaceProtect>();
    if (!this.asked && !this.entries.size) return out;
    let built = false;
    let pending = false;
    for (const q of requests) {
      const have = this.entries.get(q.id);
      const pose = q.pose && this.ownBodyMask(q.id, q.face, q.pose) ? q.pose : null;
      const seg = this.seg.phase === 'done' ? this.seg.mask : null;
      const mask = pose ?? seg;
      if (!mask) {
        if (q.contour && this.seg.phase === 'idle') this.startSegmenter();
        if (have && have.face === q.face) out.set(q.id, have.protect);
        continue;
      }
      const key = othersKeyOf(q.others);
      if (have && have.face === q.face && have.mask === mask && have.othersKey === key) {
        out.set(q.id, have.protect);
        continue;
      }
      if (!q.contour && !have) continue;
      if (built) {
        pending = true;
        if (have && have.face === q.face) out.set(q.id, have.protect);
        continue;
      }
      built = true;
      try {
        // one face alone (no others, no window): v0.3's call exactly; else the regions form
        const o = q.others;
        const alone = !o.otherCentres.length && !o.otherOvals.length && !o.otherMasks.length && !o.window;
        const protect = alone ? this.deps.build(q.face, mask) : this.deps.build(q.face, { ...o, own: mask, clipToCell: !pose && o.otherCentres.length > 0 });
        this.entries.set(q.id, { face: q.face, mask, othersKey: key, protect });
        out.set(q.id, protect);
      } catch (e) {
        this.deps.report(e, 'buildFaceProtect');
        this.entries.delete(q.id);
      }
    }
    if (pending && !this.scheduled) {
      this.scheduled = true;
      this.deps.schedule(() => {
        this.scheduled = false;
        if (!this.deps.cancelled()) this.changed();
      });
    }
    return out;
  }

  /** one face (v0.3's API; the face is 'f0'): the pose mask when it covers the face, else the selfie mask */
  update(face: Face | null, contour: boolean, bodyMask: PersonMask | null, requested: boolean): FaceProtect | null {
    if (!face) {
      if (requested) this.asked = true;
      return null;
    }
    return this.updateAll([{ id: 'f0', face, contour, pose: bodyMask, others: { otherCentres: [], otherOvals: [], otherMasks: [], window: null } }], requested).get('f0') ?? null;
  }

  get protect(): FaceProtect | null {
    return this.entries.values().next().value?.protect ?? null;
  }

  private ownBodyMask(id: string, face: Face, mask: PersonMask): boolean {
    const c = this.bodyOk.get(id);
    if (c?.face === face && c.mask === mask) return c.ok;
    let ok = false;
    try {
      ok = this.deps.covers(face, mask);
    } catch (e) {
      this.deps.report(e, 'maskCoversFace');
    }
    this.bodyOk.set(id, { face, mask, ok });
    return ok;
  }
```

4. `record(drawn)`: accept `FaceProtect | ReadonlyMap<string, FaceProtect> | null`; `const list = drawn instanceof Map ? [...drawn.values()] : drawn ? [drawn] : [];` and: drawn non-empty → `{ faceProtect: true, ...(segMask && [...this.entries.values()].some((e) => e.mask === segMask && list.includes(e.protect)) ? { faceMask: segMask } : {}) }`; empty → today's rules with `!this.entries.size` in place of `!c`.

The existing one-face tests keep passing: `update` routes through `updateAll` with exactly v0.3's decisions (body mask if it covers the face, else the segmenter's; build only on a contour warp unless a limit exists; kept once built; one segmenter run).

`Editor.tsx` (`:567-576`): the `FaceProtectSource` deps gain `schedule: (fn) => requestAnimationFrame(() => fn()),` (`build` is unchanged).

- [x] **Step 5: Bench row F (`src/bench/multiFace.ts`, append)**

```ts
/** F: buildFaceProtect for each face of group6_faces.png at 2048 with a full-frame mask, in its 128² window */
export async function rowF(): Promise<MultiRow[]> {
  const { prepareFaces } = await import('../detect/faces');
  const { buildFaceProtect, protectWindow } = await import('../tracking/faceProtect');
  const { boxCentre, ovalBox } = await import('../engine/passes/faceCap');
  const { createTracker } = await import('../tracking/tracker');
  const { modelBuffer } = await loadEngineAssets();
  const t = await createTracker({ modelBuffer, wasmBase: ENGINE_PATHS.wasmBase, delegate: 'auto' });
  const bmp = await decode(await (await fetch('/tests/fixtures/group6_faces.png')).blob(), 2048);
  const p = prepareFaces(t.detectImage(bmp, { maxFaces: 8 }), bmp.width, bmp.height);
  t.close();
  const mask = { width: 256, height: 192, data: new Uint8Array(256 * 192).fill(255) };
  return p.faces.map((f) => {
    const others = p.faces.filter((g) => g !== f);
    const t0 = performance.now();
    buildFaceProtect(f.face, { own: mask, clipToCell: true, otherCentres: others.map((g) => boxCentre(ovalBox(g.face))), otherOvals: others.map((g) => g.face.oval), otherMasks: [], window: protectWindow(f.face, bmp.width, bmp.height) }, bmp.width, bmp.height);
    return { row: 'F', config: f.id, values: { ms: Math.round((performance.now() - t0) * 10) / 10 } };
  });
}
addRunner('F', () => rowF());
```

Add `'F'` to the buttons list in `mountMultiFace`; in its `run`, only D and B pick a photo: `const photo = id === 'D' || id === 'B' ? await pick('image/*') : null;` (R, F and later rows load their own fixtures).

- [x] **Step 5b: The windowed limit on the reshape map (S §8.1) and on the GPU (S §8.2)**

Append to `src/engine/passes/faceProtect.test.ts` (imports: `buildFaceProtect, protectWindow` from `../../tracking/faceProtect`; `PersonMask` type):

```ts
describe('the limit in a 128² window (≥ 2 selectable faces, S §4.7 item 5)', () => {
  const raster = (inside: (u: number, v: number) => number): PersonMask => {
    const mw = 192;
    const mh = 256;
    const data = new Uint8Array(mw * mh);
    for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) data[y * mw + x] = Math.round(255 * inside((x + 0.5) / mw, (y + 0.5) / mh));
    return { width: mw, height: mh, data };
  };
  /** a portrait whose face is `fw` of the photo width, limited in its own window next to another face's oval */
  const windowed = (fw: number): FaceScene => {
    const pr = syntheticPortrait({ faceWidth: fw });
    const P = pr.face.pts111;
    // another face's oval (36 points on a circle, iso), two face widths to the right of this one
    const r = fw / 2;
    const cx = P[46 * 2] + 2 * fw;
    const cy = P[46 * 2 + 1];
    const other = new Float32Array(72);
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * 2 * Math.PI;
      other[i * 2] = cx + r * Math.cos(a);
      other[i * 2 + 1] = cy + ((r * pr.width) / pr.height) * Math.sin(a);
    }
    const protect = buildFaceProtect(
      pr.face,
      { own: raster(pr.inside), clipToCell: true, otherCentres: [[cx, cy]], otherOvals: [other], otherMasks: [], window: protectWindow(pr.face, pr.width, pr.height) },
      pr.width,
      pr.height,
    );
    return { name: `portrait fw ${fw}`, face: pr.face, width: pr.width, height: pr.height, inside: pr.inside, protect };
  };
  for (const fw of [0.05, 0.1, 0.25]) {
    it(`a face ${fw} of the width: fold-free, bounded stretch, no crease beyond today's (+1°)`, () => {
      const s = windowed(fw);
      expect([s.protect.width, s.protect.height]).toEqual([128, 128]);
      const aspect = s.width / s.height;
      const u = reshapeUniforms(at(CONTOUR), 1);
      const free = reshapeMapCpu(s.face, u, aspect);
      const lim = reshapeMapCpu(s.face, u, aspect, null, s.protect);
      const a = measure(s, free);
      const b = measure(s, lim);
      expect(b.minDet).toBeGreaterThanOrEqual(Math.max(MIN_DET, 1 - PROTECT_SLOPE - 0.02));
      expect(b.stretchPct).toBeLessThanOrEqual(Math.max(a.stretchPct, Math.round(100 * (1 / (1 - PROTECT_SLOPE) - 1))) + 3);
      expect(sharpestTurn(s, lim)).toBeLessThanOrEqual(sharpestTurn(s, free) + 1);
    });
  }
});
```

(`syntheticPortrait`, `measure`, `sharpestTurn`, `at`, `CONTOUR`, `MIN_DET`, `PROTECT_SLOPE`, `reshapeUniforms`, `reshapeMapCpu` and `FaceScene` are already in that file; `reshapeMapCpu` reads `protect.window`, Task 16.)

`tests/e2e/pages/reshape.ts` (Task 17's `pinCases`): each case gains `protects?: FaceProtect[]`, passed as `{ aspect, protects: c.protects }` to `pass.drawFaces` and as `{ protects: c.protects }` to `reshapeMapMulti`. Add:

```ts
declare global {
  interface Window {
    runProtectPinMulti?: (carrier: 'texture' | 'ubo') => PinCase[];
  }
}

window.runProtectPinMulti = (carrier) => {
  // two faces with their 瘦臉 limits in 128² windows, and a small face (0.1 of the fixture's) alone in its window
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const gl = canvas.getContext('webgl2')!;
  gl.getExtension('EXT_color_buffer_float');
  gl.getExtension('OES_texture_float_linear');
  const { width: W, height: H } = landmarks;
  const aspect = W / H;
  const base = adapt({ points: new Float32Array(landmarks.points) }, W, H);
  const shrink = (f: Face, k: number, dx: number): Face => {
    const b = ovalBox(f);
    const c = [b.x + b.w / 2, b.y + b.h / 2];
    const m = (a: Float32Array) => a.map((v, i) => (i % 2 === 0 ? c[0] + (v - c[0]) * k + dx : c[1] + (v - c[1]) * k));
    return { pts111: m(f.pts111), ext: m(f.ext), oval: m(f.oval), yaw: f.yaw };
  };
  const A = shrink(base, 0.45, -0.24);
  const B = shrink(base, 0.45, 0.24);
  const S = shrink(base, 0.1, 0);
  const contour = ['shape.faceSlim', 'shape.faceV', 'shape.faceNarrow'] as ParamId[];
  const u = reshapeUniforms(contour.reduce((p, k) => setParam(p, k, 1), applyPreset('original', 1)).values, 1);
  const limit = (f: Face, others: Face[]) =>
    buildFaceProtect(f, { own: null, clipToCell: false, otherCentres: others.map((g) => boxCentre(ovalBox(g))), otherOvals: others.map((g) => g.oval), otherMasks: [], window: protectWindow(f, W, H) }, W, H);
  const pA = limit(A, [B]);
  const pB = limit(B, [A]);
  const pS = limit(S, []);
  const cA = boxCentre(ovalBox(A));
  const cB = boxCentre(ovalBox(B));
  const capAB = Math.hypot(cA[0] - cB[0], (cA[1] - cB[1]) / aspect) / 2;
  const tf = (f: Face, cap: number, layer: number, p: FaceProtect): TableFace => ({ face: f, u: attenuate(u, f.yaw), layer, window: p.window ?? WHOLE, centre: boxCentre(ovalBox(f)), cap });
  const cases: { name: string; faces: TableFace[]; protects: FaceProtect[] }[] = [
    { name: `two faces, windowed limits (${carrier})`, faces: [tf(A, capAB, 0, pA), tf(B, capAB, 1, pB)], protects: [pA, pB] },
    { name: `small face in its 128² window (${carrier})`, faces: [tf(S, -1, 0, pS)], protects: [pS] },
  ];
  return pinCases(gl, cases, aspect, carrier);
};
```

(imports: `buildFaceProtect, protectWindow` from `src/tracking/faceProtect`; the `FaceProtect` type.)

Append to `tests/e2e/faceProtect.spec.ts`:

```ts
bare('per-face limits in 128² windows: GPU == CPU port for two faces and a small face, both carriers (S §8.2)', async ({ page }) => {
  await page.goto(`${DEV_URL}/tests/e2e/pages/reshape.html`);
  await page.waitForFunction(() => typeof window.runProtectPinMulti === 'function');
  for (const carrier of ['texture', 'ubo'] as const) {
    const cases = await page.evaluate((c) => window.runProtectPinMulti!(c), carrier);
    expect(cases).toHaveLength(2);
    for (const c of cases) {
      console.log(`${c.name}: ${c.n} px, ${c.moved} moved, max |GPU − CPU| = ${c.maxErrPx.toFixed(4)} px`);
      expect(c.moved).toBeGreaterThan(0);
      expect(c.maxErrPx).toBeLessThan(0.05);
    }
  }
});
```

- [x] **Step 6: Run and commit**

Run: `npx vitest run src/tracking src/ui src/engine && npm run typecheck`
Expected: PASS (snapshots match: the single-face limit is byte-equal).

Run: `npm run build && npx playwright test tests/e2e/faceProtect.spec.ts tests/e2e/reshape.spec.ts tests/e2e/parity.spec.ts`
Expected: PASS (the windowed GPU pins stay below 0.05 px on both carriers).

```bash
git add src/tracking/faceProtect.ts src/tracking/faceProtect.test.ts src/tracking/__snapshots__ src/ui/faceProtectModel.ts src/ui/faceProtectModel.test.ts src/ui/screens/Editor.tsx src/engine/passes/faceProtect.test.ts tests/e2e/pages/reshape.ts tests/e2e/faceProtect.spec.ts src/bench/multiFace.ts
git commit -m "v0.4 step 1c: the 瘦臉 limit per face (others infinitely far, Voronoi cell, 128² windows)"
```

---

### Task 20: The multi-person 美體 field (P5)

**Files:**
- Modify: `src/body/field.ts:83-164,258-322,418-430`, `src/body/field.test.ts` (rename + append), `src/body/straightness.test.ts`, `src/ui/editorModel.ts:228-271` (rename + new memo), `src/ui/editorModel.test.ts` (rename), `src/ui/screens/Editor.tsx:17,135` (rename), `tests/harness/b1/debug.ts`, `tests/harness/b1/render.ts`, `tests/harness/b2/harness.ts`, `tests/e2e/pages/parity.ts`, `src/bench/multiFace.ts` (row BF)

**Interfaces:**
- Consumes: `BodyMeasure`, `measureBody` (`measure.ts`), `relaxBackground`, `distanceOutside`, `maskOnGrid`, `MaskSampler`, `fieldMinJacobian`, `MIN_DET`.
- Produces:

```ts
export type LocalBodyId = Exclude<Extract<ParamId, `body.${string}`>, 'body.legs'>;
export interface BodyPersonInput { id: PersonId; measure: BodyMeasure; values: Readonly<Record<LocalBodyId, number>> }
export interface BodyFieldInput {
  /** body persons with a non-neutral local item, or every body person while 增高 / 長腿 is on (hands-rigid term) */
  edited: readonly BodyPersonInput[];
  /** every body person's mask, edited or not */
  masks: readonly { id: PersonId; mask: PersonMask }[];
  heightBand: HeightBand | null;
  /** 長腿, measured on the anchor person */
  legs: { value: number; measure: BodyMeasure | null };
  bodyProtect: boolean;
  aspect: number;
}
export function buildBodyField(input: BodyFieldInput, prev?: BodyField | null, longEdge?: number): BodyField | null;
/** v0.3's one-person form (tests, harnesses): `params`' body values on `measure` */
export function buildBodyFieldV1(measure: BodyMeasure | null, params: BeautyParams, aspect: number, prev?: BodyField | null, longEdge?: number): BodyField | null;
export function fieldInputV1(measure: BodyMeasure | null, params: BeautyParams, aspect: number): BodyFieldInput;
export const bodyFieldCacheStats: { maskGrids: number; relax: RelaxStats; lambdaGlobal: number; personBuilds: number };
// src/ui/editorModel.ts
export class BodyFieldMemoV1 /* today's BodyFieldMemo (editorModel.ts:228-271), renamed by sed in Step 1 */ {}
export class BodyFieldMemo {
  constructor(build: (input: BodyFieldInput, prev?: BodyField | null, longEdge?: number) => BodyField | null);
  field: BodyField | null;
  update(input: BodyFieldInput, draft?: boolean): { field: BodyField | null; changed: boolean };
}
export function bodyInputKey(input: BodyFieldInput): string;
```

- [ ] **Step 1: Rename the v0.3 entry points (mechanical) and pin today's fields**

Run (a `node` rename, not `sed -i`: Git Bash's `sed -i` rewrites the CRLF `tests/harness/b2/harness.ts` to LF; the regex never touches a `\r`, so every line ending stays as it was):
```bash
node -e "const fs=require('fs');const [re,to,...files]=process.argv.slice(1);for(const f of files)fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace(new RegExp(re,'g'),to))" '\bbuildBodyField\b' buildBodyFieldV1 src/body/field.ts src/body/field.test.ts src/body/straightness.test.ts src/ui/editorModel.ts src/ui/screens/Editor.tsx tests/harness/b1/debug.ts tests/harness/b1/render.ts tests/harness/b2/harness.ts tests/e2e/pages/parity.ts
node -e "const fs=require('fs');const [re,to,...files]=process.argv.slice(1);for(const f of files)fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace(new RegExp(re,'g'),to))" '\bBodyFieldMemo\b' BodyFieldMemoV1 src/ui/editorModel.ts src/ui/editorModel.test.ts src/ui/screens/Editor.tsx
git diff --stat
```
Expected: only those identifiers change (`\b` keeps `buildBodyFieldV1` from matching twice; in `editorModel.ts` it is one comment). `tests/harness/b2/harness.ts` is CRLF, the others LF; `git diff` must show no whole-file rewrites.

Append to `src/body/field.test.ts`:

```ts
/** FNV-1a 32 of the float bits */
const bits = (a: Float32Array) => {
  const u = new Uint32Array(a.buffer, a.byteOffset, a.length);
  let h = 0x811c9dc5;
  for (const x of u) {
    h ^= x;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
};

describe('one person ≡ v0.3 (byte-equal field, S §4.6)', () => {
  it('every scene at every local item max, with and without 背景保護, plus bands', () => {
    const out: string[] = [];
    for (const sc of scenes) {
      const m = measureBody(sc.det, sc.face);
      for (const protect of [true, false]) {
        const all = paramsInGroup('body').reduce((p, d) => setParam(p, d.id, d.bidirectional ? 0.8 : 1), applyPreset('natural', 1));
        const p = setHeightBand({ ...all, bodyProtect: protect }, { top: 0.55, bottom: 0.85, amount: 0.5 });
        const f = buildBodyFieldV1(m, p, sc.det.width / sc.det.height);
        out.push(`${sc.name} ${protect} ${f ? bits(f.data) : 'null'}`);
      }
    }
    expect(out).toMatchSnapshot();
  });
});
```

(add `applyPreset, paramsInGroup` to the file's `../engine/params` import; `setHeightBand`, `setParam`, `measureBody` and `scenes` are there already.)

Run: `npx vitest run src/body/field.test.ts && npm run typecheck`
Expected: PASS, `1 snapshot written` (today's builder, renamed only).

- [ ] **Step 2: Failing multi-person tests** (append to `src/body/field.test.ts`; add `buildBodyField, fieldInputV1, type BodyFieldInput` to the `./field` import and `maskOnGrid` to the `./mask` import)

```ts
/**
 * Two copies of the synthetic figure on a canvas k× as wide: A at the left edge, B at the right edge, each with its
 * own pose and mask (k = 2: side by side; k = 1.4: the outstretched hands overlap, "touching").
 */
function pairScene(k: number) {
  const fig = syntheticFigure();
  const m = fig.det.mask!;
  const W = Math.round(m.width * k);
  const place = (off: number) => {
    const pts = fig.det.pose.points.slice();
    for (let i = 0; i < 33; i++) pts[i * 4] = off + pts[i * 4] / k;
    const data = new Uint8Array(W * m.height);
    const ox = Math.round(off * W);
    for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width && ox + x < W; x++) data[y * W + ox + x] = m.data[y * m.width + x];
    const det: BodyDetection = { pose: { points: pts }, mask: { width: W, height: m.height, data }, people: 1, width: Math.round(fig.det.width * k), height: fig.det.height };
    return measureBody(det, null);
  };
  return { A: place(0), B: place(1 - 1 / k), aspect: (fig.det.width * k) / fig.det.height };
}

describe('multi-person field (S §4.6)', () => {
  const LOCAL = ['body.slim', 'body.waist', 'body.whr', 'body.hip', 'body.legSlim', 'body.arms', 'body.shoulder', 'body.neck', 'body.head'] as const;
  /** every one-way local item at v, the two-way ones neutral (0.5) */
  const local = (v: number) => Object.fromEntries(LOCAL.map((id) => [id, paramDef(id).bidirectional ? 0.5 : v])) as BodyFieldInput['edited'][number]['values'];
  const waist = (v: number) => ({ ...local(0), 'body.waist': v });
  const sceneInput = (s: ReturnType<typeof pairScene>, edited: BodyFieldInput['edited'], masks = [{ id: 'A', mask: s.A.mask! }, { id: 'B', mask: s.B.mask! }]): BodyFieldInput => ({
    edited,
    masks,
    heightBand: null,
    legs: { value: 0, measure: null },
    bodyProtect: true,
    aspect: s.aspect,
  });
  const len = (f: { width: number; data: Float32Array }, i: number) => Math.hypot(f.data[i * 2], f.data[i * 2 + 1]);
  const side = pairScene(2);
  const touching = pairScene(1.4);

  it('a second, unedited person far away changes nothing on the edited person', () => {
    const multi = buildBodyField(sceneInput(side, [{ id: 'A', measure: side.A, values: waist(0.6) }]))!;
    const single = buildBodyField(sceneInput(side, [{ id: 'A', measure: side.A, values: waist(0.6) }], [{ id: 'A', mask: side.A.mask! }]))!;
    const inA = maskOnGrid(new MaskSampler(side.A.mask!, side.A.aspect), multi.width, multi.height, side.A.aspect);
    let worst = 0;
    for (let i = 0; i < inA.length; i++) if (inA[i]) worst = Math.max(worst, Math.abs(multi.data[i * 2] - single.data[i * 2]), Math.abs(multi.data[i * 2 + 1] - single.data[i * 2 + 1]));
    expect(worst).toBeLessThan(1e-6);
  });
  it('细腰 on person B leaves person A’s texels at 0 displacement; no fold; λ_global = 1', () => {
    const f = buildBodyField(sceneInput(touching, [{ id: 'B', measure: touching.B, values: waist(1) }]))!;
    const inA = maskOnGrid(new MaskSampler(touching.A.mask!, touching.A.aspect), f.width, f.height, touching.A.aspect);
    let worst = 0;
    for (let i = 0; i < inA.length; i++) if (inA[i]) worst = Math.max(worst, len(f, i));
    expect(worst).toBeLessThan(1e-6);
    expect(fieldMinJacobian(f)).toBeGreaterThanOrEqual(MIN_DET);
    expect(bodyFieldCacheStats.lambdaGlobal).toBe(1);
  });
  it('two touching persons with every local item at max: fold-free and λ_global = 1 (the per-person guards did the work)', () => {
    const both = buildBodyField(sceneInput(touching, [{ id: 'A', measure: touching.A, values: local(1) }, { id: 'B', measure: touching.B, values: local(1) }]))!;
    expect(fieldMinJacobian(both)).toBeGreaterThanOrEqual(MIN_DET);
    expect(bodyFieldCacheStats.lambdaGlobal).toBe(1);
  });
  it('B at max does not scale A down: A’s strongest texel matches A edited alone', () => {
    const aOnly = sceneInput(side, [{ id: 'A', measure: side.A, values: waist(0.6) }]);
    const alone = buildBodyField(aOnly)!;
    const both = buildBodyField({ ...aOnly, edited: [...aOnly.edited, { id: 'B', measure: side.B, values: local(1) }] })!;
    const inA = maskOnGrid(new MaskSampler(side.A.mask!, side.A.aspect), alone.width, alone.height, side.A.aspect);
    let at = -1;
    for (let i = 0; i < inA.length; i++) if (inA[i] && (at < 0 || len(alone, i) > len(alone, at))) at = i;
    expect(len(alone, at)).toBeGreaterThan(0);
    expect(len(both, at)).toBeCloseTo(len(alone, at), 6);
  });
  it('a draft rebuilds only the dragged person', () => {
    const two = (b: number) => sceneInput(side, [{ id: 'A', measure: side.A, values: waist(0.5) }, { id: 'B', measure: side.B, values: waist(b) }]);
    buildBodyField(two(0.5), null, 128);
    const n = bodyFieldCacheStats.personBuilds;
    buildBodyField(two(0.6), null, 128);
    expect(bodyFieldCacheStats.personBuilds).toBe(n + 1);
  });
  it('fieldInputV1: one person, its mask the only mask, 長腿 on it', () => {
    const fig = syntheticFigure();
    const m = measureBody(fig.det, fig.face);
    const i = fieldInputV1(m, setParam(defaultParams(), 'body.legs', 0.4), 0.75);
    expect(i.edited.map((p) => p.id)).toEqual(['p0']);
    expect(i.masks).toEqual([{ id: 'p0', mask: m.mask }]);
    expect(i.legs).toEqual({ value: 0.4, measure: m });
  });
});
```

(add `paramDef` to the `../engine/params` import.)

Run: `npx vitest run src/body/field.test.ts`
Expected: FAIL (`buildBodyField` with an input object is undefined).

- [ ] **Step 3: Implement in `src/body/field.ts`**

1. Replace `localField` (`:258-322`) by the per-person part and the shared finish. `personTerms` is today's `:259-312` with `localTerms(m, values)` and `bodyProtect` for `params.bodyProtect`; nothing else changes, so one person stays byte-equal:

```ts
/** one person's local displacement before relaxation: its terms, each × its own 背景保護 weights (S §4.6 item 2) */
function personTerms(m: BodyMeasure, values: Readonly<Record<string, number>>, bodyProtect: boolean, w: number, h: number, bands: readonly Band[]): { gx: Float32Array; gy: Float32Array } | null {
  const terms = localTerms(m, values);
  const handBand = bands.length ? handsRigidInBands(m.hands, bands) : null;
  if (handBand) terms.push(handBand);
  if (!terms.length) return null;
  const A = m.aspect;
  const N = w * h;
  const T = terms.length;
  const grid = m.mask ? maskGrid(m, m.mask, w, h) : null;
  const protect = bodyProtect && grid;
  // every term separately (背景保護 bands each part by its own Δ = its largest displacement on the silhouette)
  while (termBufs.length < T) termBufs.push(new TermBuf());
  const own = termBufs.slice(0, T);
  for (const b of own) b.n = 0;
  const delta = new Float64Array(T);
  const edge = protect ? grid.edge : null;
  const acc = { x: 0, y: 0, ka: 0 };
  let maxKa = 0;
  for (let y = 0; y < h; y++) {
    const qy = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const q: V2 = [((x + 0.5) / w) * A, qy];
      const i = y * w + x;
      let ka = 0;
      for (let t = 0; t < T; t++) {
        acc.x = 0;
        acc.y = 0;
        acc.ka = 0;
        terms[t](q, 1, acc);
        ka += acc.ka;
        if (acc.x === 0 && acc.y === 0) continue;
        own[t].push(i, acc.x, acc.y);
        if (edge?.[i]) delta[t] = Math.max(delta[t], Math.hypot(acc.x, acc.y));
      }
      if (ka > maxKa) maxKa = ka;
    }
  }
  // the summed-k·a cap: the capsule terms are linear in their capScale
  const capScale = maxKa > SUM_KA_MAX ? SUM_KA_MAX / maxKa : 1;

  const gx = new Float32Array(N);
  const gyy = new Float32Array(N);
  const texel = 1 / h;
  for (let t = 0; t < T; t++) {
    const s = terms[t].capped ? capScale : 1;
    const d = delta[t] * s;
    const M = protect ? grid.weights(Math.max(PROTECT_DILATE * d, 2 * texel), Math.max(PROTECT_FEATHER * d, 3 * texel)) : null;
    const { idx, xy, n } = own[t];
    for (let k = 0; k < n; k++) {
      const i = idx[k];
      const f = M ? M[i] * s : s;
      gx[i] += f * xy[2 * k];
      gyy[i] += f * xy[2 * k + 1];
    }
  }
  return { gx, gy: gyy };
}

/** relax once with every person held fixed, keep inside the frame (S §4.6 items 6–7) */
function finishLocal(gx: Float32Array, gy: Float32Array, inside: Uint8Array | null, dist: () => Float32Array, protect: boolean, w: number, h: number, A: number): LocalGrid | null {
  if (inside) {
    const alphaScale = (BODY_FIELD_LONG_EDGE / Math.max(w, h)) ** 2;
    bodyFieldCacheStats.relax = relaxBackground(gx, gy, inside, dist(), w, h, 1 / h, protect ? RELAX_PROTECT : RELAX_FREE, alphaScale);
  }
  keepInFrame(gx, gy, w, h, A);
  let any = false;
  for (let i = 0; i < w * h && !any; i++) any = Math.abs(gx[i]) > 1e-9 || Math.abs(gy[i]) > 1e-9;
  return any ? { x: gx, y: gy } : null;
}
```

(No arithmetic is reordered, so one person stays byte-equal: today's `localField(m, params, w, h, bands)` ≡ `personTerms(m, params.values, params.bodyProtect, …)` then `finishLocal(gx, gy, grid?.inside ?? null, () => grid!.dist(), params.bodyProtect && !!grid, w, h, m.aspect)` with `grid = m.mask ? maskGrid(m, m.mask, w, h) : null`. Delete `localField`.)
2. `localTerms(m, params)` → `localTerms(m, values: Readonly<Record<string, number>>)`: replace `params.values` with `values` (`:419`).
3. The budget, the per-person guard and the builder:

```ts
export type LocalBodyId = Exclude<Extract<ParamId, `body.${string}`>, 'body.legs'>;
export interface BodyPersonInput {
  id: PersonId;
  measure: BodyMeasure;
  values: Readonly<Record<LocalBodyId, number>>;
}
export interface BodyFieldInput {
  edited: readonly BodyPersonInput[];
  masks: readonly { id: PersonId; mask: PersonMask }[];
  heightBand: HeightBand | null;
  legs: { value: number; measure: BodyMeasure | null };
  bodyProtect: boolean;
  aspect: number;
}

/** magnitude budget of L_p against the other persons: |L| ← smin(|L|, 0.45 · d_others), smooth-min width 2 texels */
function budgetOthers(gx: Float32Array, gy: Float32Array, dOthers: Float32Array, h: number): void {
  const k = 2 / h;
  for (let i = 0; i < gx.length; i++) {
    const L = Math.hypot(gx[i], gy[i]);
    if (L === 0) continue;
    const B = 0.45 * (dOthers[i] / h);
    const hh = Math.max(k - Math.abs(L - B), 0) / k;
    const Ln = Math.max(Math.min(L, B) - 0.25 * hh * hh * k, 0);
    if (Ln >= L) continue;
    gx[i] *= Ln / L;
    gy[i] *= Ln / L;
  }
}

const maskIds = new WeakMap<PersonMask, number>();
let maskSeq = 0;
const maskId = (m: PersonMask) => {
  let v = maskIds.get(m);
  if (v === undefined) maskIds.set(m, (v = ++maskSeq));
  return v;
};
/** budgeted, guarded L_p per (person measure, values, others, grid, protect, bands) — a draft reuses the others' */
const personCache = new WeakMap<BodyMeasure, Map<string, { gx: Float32Array; gy: Float32Array }>>();

export function buildBodyField(input: BodyFieldInput, prev?: BodyField | null, longEdge: number = BODY_FIELD_LONG_EDGE): BodyField | null {
  bodyFieldCacheStats.lambdaGlobal = 1;
  const edge = Number.isFinite(longEdge) ? Math.max(8, Math.round(longEdge)) : BODY_FIELD_LONG_EDGE;
  const [w, h] = fieldSize(input.aspect, edge);
  const A = input.edited[0]?.measure.aspect ?? input.legs.measure?.aspect ?? (Number.isFinite(input.aspect) && input.aspect > 0 ? input.aspect : 1);
  const bands: Band[] = [];
  const hb = input.heightBand ? heightBand(input.heightBand.top, input.heightBand.bottom, input.heightBand.amount) : null;
  if (hb) bands.push(hb);
  const lm = input.legs.measure;
  if (lm?.legs && input.legs.value > EPS) {
    const L = lm.legs;
    const lb = legsBand(L.hipY, L.kneeY, L.feetY, input.legs.value * L.vis, bands, L.ankleY);
    if (lb) bands.push(lb);
  }

  let local: LocalGrid | null = null;
  // `edited` is trusted as given: the editor lists a person with a non-neutral local item, or any body person while a
  // band is on (today's hands-rigid term rides with the bands); fieldInputV1 always lists its one person
  const edited = input.edited;
  if (edited.length === 1 && input.masks.every((m) => m.id === edited[0].id || m.mask === edited[0].measure.mask)) {
    // one person (nobody else to protect): today's builder exactly
    const m = edited[0].measure;
    const terms = personTerms(m, edited[0].values, input.bodyProtect, w, h, bands);
    if (terms) {
      // (the same cached grid personTerms used: no extra maskGrids miss, as today)
      const grid = m.mask ? maskGrid(m, m.mask, w, h) : null;
      local = finishLocal(terms.gx, terms.gy, grid?.inside ?? null, () => grid!.dist(), input.bodyProtect && !!grid, w, h, m.aspect);
    }
  } else if (edited.length) {
    const N = w * h;
    const grids = new Map(input.masks.map((m) => [m.id, maskOnGrid(new MaskSampler(m.mask, A), w, h, A)]));
    const gx = new Float32Array(N);
    const gy = new Float32Array(N);
    const bandsKey = JSON.stringify(bands);
    // λ_p only once two or more persons are edited; with one, the global guard below is enough (S §4.6 item 4)
    const guardEach = edited.length >= 2;
    for (const p of edited) {
      const others = input.masks.filter((m) => m.id !== p.id);
      const key = `${JSON.stringify(p.values)}|${w}x${h}|${others.map((o) => maskId(o.mask)).join(',')}|${input.bodyProtect}|${bandsKey}|${guardEach}`;
      let byKey = personCache.get(p.measure);
      if (!byKey) personCache.set(p.measure, (byKey = new Map()));
      let L = byKey.get(key);
      if (!L) {
        bodyFieldCacheStats.personBuilds++;
        const t = personTerms(p.measure, p.values, input.bodyProtect, w, h, bands);
        if (!t) continue;
        if (others.length) {
          const union = new Uint8Array(N);
          for (const o of others) {
            const g = grids.get(o.id)!;
            for (let i = 0; i < N; i++) union[i] |= g[i];
          }
          budgetOthers(t.gx, t.gy, distanceOutside(union, w, h), h);
        }
        const lambda = guardEach ? personGuard(t.gx, t.gy, bands, w, h, A, edge < BODY_FIELD_LONG_EDGE ? GUARD_STEPS_DRAFT : GUARD_STEPS_FULL) : 1;
        if (lambda < 1) for (let i = 0; i < N; i++) (t.gx[i] *= lambda), (t.gy[i] *= lambda);
        L = t;
        if (byKey.size >= 8) byKey.delete(byKey.keys().next().value!);
        byKey.set(key, L);
      }
      for (let i = 0; i < N; i++) {
        gx[i] += L.gx[i];
        gy[i] += L.gy[i];
      }
    }
    const inside = new Uint8Array(N);
    for (const g of grids.values()) for (let i = 0; i < N; i++) inside[i] |= g[i];
    local = finishLocal(gx, gy, grids.size ? inside : null, () => distanceOutside(inside, w, h), input.bodyProtect && grids.size > 0, w, h, A);
  }
  if (!bands.length && !local) return null;
  return assembleGuarded(local, bands, w, h, A, edge, prev);
}
```

where `assembleGuarded` is today's tail of `buildBodyField` (`:124-163`) moved verbatim, plus the λ_global record. After Step 1's rename, today's whole builder is the exported `function buildBodyFieldV1(measure, params, aspect, prev?, longEdge?)` at `field.ts:99-164`: delete that function body entirely (its head moves into `buildBodyField` above, its tail into `assembleGuarded` below) and define `buildBodyFieldV1` once, as the thin wrapper at the end of this step — the file must not keep two `buildBodyFieldV1` declarations:

```ts
/** bands ∘ local into the backward field; the global fold guard scales the local part back (λ_global, S §4.6 item 5) */
function assembleGuarded(local: LocalGrid | null, bands: readonly Band[], w: number, h: number, A: number, edge: number, prev?: BodyField | null): BodyField | null {
  const data = prev && prev.width === w && prev.height === h ? prev.data : new Float32Array(w * h * 2);
  const gy = new Float64Array(h);
  for (let y = 0; y < h; y++) gy[y] = backwardY(bands, (y + 0.5) / h);

  const assemble = (lambda: number) => {
    for (let y = 0; y < h; y++) {
      const yc = (y + 0.5) / h;
      const sy = gy[y];
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 2;
        let lx = 0;
        let ly = 0;
        if (local && lambda > 0) {
          const u = (x + 0.5) / w;
          lx = bands.length ? sampleGrid(local.x, w, h, u, sy) : local.x[y * w + x];
          ly = bands.length ? sampleGrid(local.y, w, h, u, sy) : local.y[y * w + x];
        }
        data[i] = (lambda * lx) / A; // Q → UV: x is scaled by the aspect
        data[i + 1] = sy - yc + lambda * ly;
      }
    }
  };
  assemble(1);
  const field: BodyField = { width: w, height: h, data, version: ++versionCounter };
  if (local && fieldMinJacobian(field) < MIN_DET) {
    // should not happen within the slider range; scale the local part back rather than ship a fold
    let lo = 0;
    let hi = 1;
    const steps = edge < BODY_FIELD_LONG_EDGE ? GUARD_STEPS_DRAFT : GUARD_STEPS_FULL;
    for (let i = 0; i < steps; i++) {
      const m = (lo + hi) / 2;
      assemble(m);
      if (fieldMinJacobian(field) >= MIN_DET) lo = m;
      else hi = m;
    }
    assemble(lo);
    bodyFieldCacheStats.lambdaGlobal = lo;
  }
  let any = false;
  for (let i = 0; i < data.length && !any; i++) any = Math.abs(data[i]) > 1e-9;
  return any ? field : null;
}
```

and

```ts
/** λ_p: bisect this person's term alone, assembled through the bands, when its own field folds (S §4.6 item 4) */
function personGuard(gx: Float32Array, gy: Float32Array, bands: readonly Band[], w: number, h: number, A: number, steps: number): number {
  const data = new Float32Array(w * h * 2);
  const fill = (lambda: number) => {
    for (let y = 0; y < h; y++) {
      const sy = backwardY(bands, (y + 0.5) / h);
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const lx = bands.length ? sampleGrid(gx, w, h, (x + 0.5) / w, sy) : gx[i];
        const ly = bands.length ? sampleGrid(gy, w, h, (x + 0.5) / w, sy) : gy[i];
        data[i * 2] = (lambda * lx) / A;
        data[i * 2 + 1] = sy - (y + 0.5) / h + lambda * ly;
      }
    }
  };
  const field = { width: w, height: h, data, version: 0 };
  fill(1);
  if (fieldMinJacobian(field) >= MIN_DET) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < steps; i++) {
    const m = (lo + hi) / 2;
    fill(m);
    if (fieldMinJacobian(field) >= MIN_DET) lo = m;
    else hi = m;
  }
  return lo;
}

/** the v0.3 input: one person (id 'p0') with `params`' local values; its mask is the only mask */
export function fieldInputV1(measure: BodyMeasure | null, params: BeautyParams, aspect: number): BodyFieldInput {
  const values = Object.fromEntries(paramsInGroup('body').filter((d) => d.id !== 'body.legs').map((d) => [d.id, params.values[d.id]])) as Record<LocalBodyId, number>;
  return {
    edited: measure ? [{ id: 'p0', measure, values }] : [],
    masks: measure?.mask ? [{ id: 'p0', mask: measure.mask }] : [],
    heightBand: params.heightBand,
    legs: { value: params.values['body.legs'], measure },
    bodyProtect: params.bodyProtect,
    aspect,
  };
}

export function buildBodyFieldV1(measure: BodyMeasure | null, params: BeautyParams, aspect: number, prev?: BodyField | null, longEdge?: number): BodyField | null {
  if (!bodyActive(params)) return null;
  return buildBodyField(fieldInputV1(measure, params, aspect), prev, longEdge);
}
```

`bodyFieldCacheStats` gains `lambdaGlobal: 1, personBuilds: 0` (type and initial value). Imports: add `HeightBand, PersonId` to the `../types` type import (`distanceOutside`, `MaskSampler`, `maskOnGrid`, `sampleGrid`, `paramsInGroup` are imported already, `:11-14`).

A v0.3 input whose `edited` list is empty (no measure: only the 增高 band) skips both branches: `local` stays null exactly as before. With a measure, fieldInputV1 always lists the person, so the band-only case still gets today's hands-rigid term from `personTerms`.

- [ ] **Step 4: The new memo (`src/ui/editorModel.ts`)**

Below `BodyFieldMemoV1` add:

```ts
const measureIds = new WeakMap<object, number>();
let measureSeq = 0;
const objId = (o: object) => {
  let v = measureIds.get(o);
  if (v === undefined) measureIds.set(o, (v = ++measureSeq));
  return v;
};

/** what the multi-person field depends on (S §4.6 item 8): every edited person's values and measure, the band, 長腿
 * with its anchor's measure, 背景保護, the aspect and the masks */
export function bodyInputKey(i: BodyFieldInput): string {
  return JSON.stringify([
    i.edited.map((p) => [p.id, objId(p.measure), p.values]),
    i.masks.map((m) => [m.id, objId(m.mask)]),
    i.heightBand && [i.heightBand.top, i.heightBand.bottom, i.heightBand.amount],
    i.legs.value,
    i.legs.measure ? objId(i.legs.measure) : 0,
    i.bodyProtect,
    i.aspect,
  ]);
}

/** BodyFieldMemoV1 for the multi-person input: the same draft / full rules, keyed on bodyInputKey */
export class BodyFieldMemo {
  private key: string | null = null;
  private draft = false;
  field: BodyField | null = null;

  constructor(private readonly build: (input: BodyFieldInput, prev?: BodyField | null, longEdge?: number) => BodyField | null) {}

  update(input: BodyFieldInput, draft = false): { field: BodyField | null; changed: boolean } {
    const key = bodyInputKey(input);
    if (key === this.key && (draft || !this.draft)) return { field: this.field, changed: false };
    const before = this.field;
    const beforeVersion = before?.version;
    this.field = draft ? this.build(input, before, BODY_DRAFT_LONG_EDGE) : this.build(input, before);
    this.key = key;
    this.draft = draft && this.field !== null;
    return { field: this.field, changed: this.field !== before || this.field?.version !== beforeVersion };
  }
}
```

and a test in `src/ui/editorModel.test.ts`:

```ts
describe('BodyFieldMemo (multi-person)', () => {
  it('rebuilds only when the input key changes; a full build answers a later draft', () => {
    const build = vi.fn((_i: BodyFieldInput, _p?: BodyField | null, _e?: number) => makeBodyField());
    const memo = new BodyFieldMemo(build);
    const m = {} as BodyMeasure;
    const input = (waist: number): BodyFieldInput => ({ edited: [{ id: 'f0', measure: m, values: { 'body.waist': waist } as never }], masks: [], heightBand: null, legs: { value: 0, measure: null }, bodyProtect: true, aspect: 0.75 });
    expect(memo.update(input(0.5)).changed).toBe(true);
    expect(memo.update(input(0.5), true).changed).toBe(false);
    expect(memo.update(input(0.6), true).changed).toBe(true);
    expect(build.mock.calls.at(-1)![2]).toBe(BODY_DRAFT_LONG_EDGE);
  });
});
```

(import `BodyFieldMemo`, `type BodyFieldInput`.)

- [ ] **Step 5: Bench row BF and run**

`src/bench/multiFace.ts`, append:

```ts
/** BF: buildBodyField with 4 persons (group_people's two measures plus their mirrored copies), full and draft */
export async function rowBF(): Promise<MultiRow[]> {
  const { buildBodyField } = await import('../body/field');
  const { measureBody } = await import('../body/measure');
  const j = (await (await fetch('/tests/fixtures/group_people.pose.json')).json()) as { width: number; height: number; poses: { points: number[]; mask: { width: number; height: number; data: string } | null }[] };
  const dec = (m: { width: number; height: number; data: string } | null) => (m ? { width: m.width, height: m.height, data: Uint8Array.from(atob(m.data), (c) => c.charCodeAt(0)) } : null);
  const half = j.poses.map((p) => ({ pose: { points: new Float32Array(p.points) }, mask: dec(p.mask) }));
  const mirrored = half.map((b) => {
    const pts = b.pose.points.slice();
    for (let i = 0; i < 33; i++) pts[i * 4] = 1 - pts[i * 4];
    return { pose: { points: pts }, mask: b.mask };
  });
  const all = [...half, ...mirrored].slice(0, 4);
  const measures = all.map((b) => measureBody({ pose: b.pose, mask: b.mask, people: 1, width: j.width, height: j.height }, null));
  const values = { 'body.slim': 0.6, 'body.waist': 0.8, 'body.whr': 0, 'body.hip': 0.5, 'body.legSlim': 0.5, 'body.arms': 0.5, 'body.shoulder': 0, 'body.neck': 0, 'body.head': 0 };
  const input = {
    edited: measures.map((m, i) => ({ id: `b${i}`, measure: m, values })),
    masks: all.flatMap((b, i) => (b.mask ? [{ id: `b${i}`, mask: b.mask }] : [])),
    heightBand: null,
    legs: { value: 0, measure: null },
    bodyProtect: true,
    aspect: j.width / j.height,
  };
  const time = (edge?: number) => {
    const t0 = performance.now();
    buildBodyField(input as never, null, edge);
    return Math.round(performance.now() - t0);
  };
  return [{ row: 'BF', config: '4 persons', values: { full_ms: time(), draft_ms: time(128) } }];
}
addRunner('BF', () => rowBF());
```

(add `'BF'` to the buttons list in `mountMultiFace`.)

Run: `npx vitest run src/body src/ui && npm run typecheck`
Expected: PASS (the snapshot of Step 1 still matches: one person byte-equal).

Run: `npm run build && npx playwright test tests/e2e/body.spec.ts tests/e2e/parity.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/body/field.ts src/body/field.test.ts src/body/__snapshots__ src/body/straightness.test.ts src/ui/editorModel.ts src/ui/editorModel.test.ts src/ui/screens/Editor.tsx tests/harness/b1 tests/harness/b2/harness.ts tests/e2e/pages/parity.ts src/bench/multiFace.ts
git commit -m "v0.4 step 1c: one 美體 field for every person (others as a budget, per-person guard, relax once)"
```

---

### Task 21: The editor on persons — cache, first answer, bodies, per-face limits, frames (sub-step 1c gate)

**Files:**
- Modify: `src/edit/migrate.ts` (append `firstAnswer`), `src/edit/migrate.test.ts` (append), `src/ui/editorModel.ts` (append helpers), `src/ui/editorModel.test.ts` (append), `src/ui/state.ts` (EditorSource: drop `body`, CRLF), `src/ui/flows.ts` (drop the `body` line, CRLF), `src/ui/screens/Editor.tsx`, `tests/e2e/fixtures.ts` (helpers); for the S §4.4 editor fold safety net: `src/types.ts` (`RenderFace.warpScale?`, CRLF), `src/engine/index.ts` (`job()`, CRLF), `src/edit/frame.ts` (`buildFrame` gains `warpScales`), `src/engine/passes/reshapeCpu.ts` (export `mapMinDet`; header)
- Create: `tests/e2e/persons.spec.ts` (first cases; Task 23 appends), `src/edit/warpGuard.ts`, `src/edit/warpGuard.test.ts`

**Interfaces:**
- Consumes: everything of Tasks 8–20.
- Produces:

```ts
// src/edit/migrate.ts
export interface AnswerInput {
  /** the cache the editor opened with (a 基本模式 cache to merge into), or null */
  detect: DetectionCache | null;
  /** the detection (null in 基本模式: no face answer) */
  prepared: PreparedFaces | null;
  size: { width: number; height: number };
  v1Body: V1Bodies | null;
  rematch: Record<PersonId, Rect> | null;
  faceSeed: FaceSeed;
}
export interface Answer {
  detect: DetectionCache;
  /** apply to the current edit and to every undo state (UndoStack.rebase) */
  rebase: (e: EditState) => EditState;
  /** persons were renamed or reset by a rematch: show the cache-dropped toast */
  dropped: boolean;
}
export function firstAnswer(a: AnswerInput): Answer;
// src/ui/editorModel.ts
export function bodyDetectionOf(cache: DetectionCache, bodyId: string): BodyDetection | null;
export function measurePersons(cache: DetectionCache | null, faceOf: (faceId: string) => Face | null, measure: (d: BodyDetection, f: Face | null) => BodyMeasure, onError: (e: unknown) => void): Map<PersonId, BodyMeasure>;
export function fieldInputOf(edit: EditState, cache: DetectionCache | null, measures: ReadonlyMap<PersonId, BodyMeasure>, aspect: number): BodyFieldInput;
export function protectRequests(cache: DetectionCache, faces: readonly SessionFace[], edit: EditState, size: { width: number; height: number }): ProtectRequest[];
export function frameFacesOf(cache: DetectionCache | null, faces: readonly SessionFace[]): FrameFaceIn[];
/** a detection-driven rebase keeps a saved output saved (U2): the stamp follows the edit key when it matched before */
export function rebaseStamp(saved: OutputStamp | null, prevKey: string, nextKey: string, field: number): OutputStamp | null;
// src/edit/warpGuard.ts (S §4.4 last bullet)
export function warpGuard(frame: StillFrame, aspect: number, opts?: { minDet?: number; grid?: number; steps?: number }): number[];
// src/engine/passes/reshapeCpu.ts
export function mapMinDet(map: UvMap, box: readonly [number, number, number, number], n?: number): number;
// src/types.ts: RenderFace gains   warpScale?: number   (λ_f, default 1: multiplies the face's warp strengths only)
// src/edit/frame.ts: buildFrame(edit, faces, obstacles, protects, primary, warpScales?: ReadonlyMap<string, number>)
```

- [ ] **Step 1: Failing tests for `firstAnswer` (every answer-time row of S §5.3 and the seed rule of C2)**

Append to `src/edit/migrate.test.ts`. Imports to add: `firstAnswer` (`./migrate`), `personFromPreset, withPersons` (`./state`), `prepareFaces` (`../detect/faces`), `cacheBody` (`../detect/testCaches`), `defaultParams` is already there; plus `readFileSync` (`node:fs`), the `Landmarks478` type, and the `fx` / `sample` / `lmAt` helpers copied verbatim from `src/detect/faces.test.ts` (Task 13 Step 3):

```ts
describe('firstAnswer (S §3.3 item 4, §5.3 answer-time rows, C2)', () => {
  const size = { width: 1000, height: 1000 };
  const two = prepareFaces([lmAt(0.3, 0.4, 0.2), lmAt(0.7, 0.4, 0.12)], 1000, 1000);
  const v1edit = () => openState(v1(), SIZE).edit;
  const base = { detect: null, size, v1Body: null, rematch: null, faceSeed: null } as const;
  it('a v1 entry: the look on the primary (largest × central), neutral for the rest, a cache scanned upright', () => {
    const a = firstAnswer({ ...base, prepared: two });
    const e = a.rebase(v1edit());
    expect(a.detect.primary).toBe('f0');
    expect(e.persons.f0).toEqual(splitLegacy(applyPreset('refined', 1)).person);
    expect(e.persons.f1).toEqual(neutralPerson());
    expect(a.detect.faceScans).toEqual([{ quarter: 0, flipH: false }]);
    expect(e.primaryInit).toBeNull();
  });
  it('基本模式 (no tracker): the p0 form, faceScans []', () => {
    const a = firstAnswer({ ...base, prepared: null });
    expect(a.detect.faceScans).toEqual([]);
    expect(Object.keys(a.rebase(v1edit()).persons)).toEqual(['p0']);
  });
  it('v1 with a body that pairs with no face (A13): b0 keeps the 9 local 美體 values, the face primary gets the face look', () => {
    const p = setParam(applyPreset('refined', 1), 'body.waist', 0.7);
    const edit = openState(v1({ params: p }), SIZE).edit;
    const a = firstAnswer({ ...base, prepared: two, v1Body: { bodies: [cacheBody('b0', 0.92)], complete: true } });
    const e = a.rebase(edit);
    const b0 = a.detect.persons.find((x) => x.body === 'b0')!;
    expect(b0.face).toBeNull();
    expect(e.persons[b0.id].values['body.waist']).toBe(0.7);
    expect(e.persons[b0.id].values['skin.smooth']).toBe(0);
    expect(e.persons.f0.values['body.waist']).toBe(0);
    expect(e.persons.f0.values['skin.smooth']).toBe(personFromPreset('refined', 1).values['skin.smooth']);
  });
  it('a camera seed on face B makes B the primary with the look; no box contains the seed → everyone from the template', () => {
    const look = { photo: splitLegacy(defaultParams()).photo, person: personFromPreset('glow', 1) };
    const shot = cameraShotEdit(look, { x: 0.7, y: 0.4 });
    const a = firstAnswer({ ...base, prepared: two, faceSeed: { x: 0.7, y: 0.4 } });
    expect(a.detect.primary).toBe('f1');
    expect(a.rebase(shot).persons.f1).toEqual(look.person);
    expect(a.rebase(shot).persons.f0).toEqual(neutralPerson());
    const miss = firstAnswer({ ...base, prepared: two, faceSeed: { x: 0.05, y: 0.95 } });
    expect(Object.values(miss.rebase(shot).persons).every((p) => JSON.stringify(p) === JSON.stringify(neutralPerson()))).toBe(true);
  });
  it('p0: an edit made before the answer goes to the primary (unsure → 大眼 0.8 → 2 faces)', () => {
    const e0 = openState(v1(), SIZE).edit;
    const meanwhile = { ...e0, persons: { p0: { ...e0.persons.p0, values: { ...e0.persons.p0.values, 'shape.eyeEnlarge': 0.8 } } } };
    const e = firstAnswer({ ...base, prepared: two }).rebase(meanwhile);
    expect(e.persons.f0.values['shape.eyeEnlarge']).toBe(0.8);
    expect(e.persons.f1).toEqual(neutralPerson());
  });
  it('a dropped cache is rematched by face box: ids renamed, the 長腿 anchor follows, unmatched persons get the template', () => {
    const glow = assignPersons(editFromLegacy(applyPreset('glow', 1), { primaryInit: true }), ['f0', 'f1'], 'f0');
    const old = withPersons(glow, ['f1'], () => personFromPreset('refined', 1));
    const anchored = { ...old, photo: { ...old.photo, legsAnchor: 'f1' } };
    // the old f1 sits where the new f0 is; the old f0 matches nothing
    const a = firstAnswer({ ...base, prepared: two, rematch: { f1: two.faces[0].box, f0: { x: 0.9, y: 0.9, w: 0.05, h: 0.05 } } });
    const e = a.rebase(anchored);
    expect(a.dropped).toBe(true);
    expect(e.persons.f0).toEqual(personFromPreset('refined', 1));
    expect(e.photo.legsAnchor).toBe('f0');
    expect(e.persons.f1).toEqual(old.template);
    expect(old.template).toEqual(neutralPerson());
  });
  it('a 基本模式 cache with bodies gains its faces; the body person keeps its id and params (A15)', () => {
    const basic = firstAnswer({ ...base, prepared: null, v1Body: { bodies: [cacheBody('b0', 0.3)], complete: true } });
    const merged = firstAnswer({ ...base, detect: basic.detect, prepared: two });
    expect(merged.detect.persons.map((p) => p.id)).toContain('b0');
    expect(merged.detect.faceScans).toEqual([{ quarter: 0, flipH: false }]);
  });
});
```

(`assignPersons`, `editFromLegacy`, `splitLegacy`, `cameraShotEdit`, `openState`, `setParam`, `SIZE` and `v1` are already in this file.)

Run: `npx vitest run src/edit/migrate.test.ts`
Expected: FAIL (`firstAnswer` is not exported).

- [ ] **Step 2: Implement `firstAnswer` (append to `src/edit/migrate.ts`)**

Imports at the top of `migrate.ts` become:

```ts
import { boxScore, buildCache, cachedFits, noFaceCache, poseBox, rematchByIoU, scanned0, withFaces } from '../detect/cache';
import { EMPTY_PREPARED, type PreparedFaces } from '../detect/faces';
import { seedPrimary } from '../detect/persons';
import { stableKey } from '../store/undo';
import type { CachedBody, CameraLook, DetectionCache, EditState, FaceSeed, HistoryEntry, PersonId, PersonParams, Rect } from '../types';
import { editFromLegacy, splitLegacy } from './legacy';
import { assignPersons, neutralPerson, P0, renamePersons, sanitizeEditState, withPersons } from './state';
```

and at the end of the file:

```ts
export interface AnswerInput {
  detect: DetectionCache | null;
  prepared: PreparedFaces | null;
  size: { width: number; height: number };
  v1Body: V1Bodies | null;
  rematch: Record<PersonId, Rect> | null;
  faceSeed: FaceSeed;
}
export interface Answer {
  detect: DetectionCache;
  rebase: (e: EditState) => EditState;
  dropped: boolean;
}

const LOCAL_BODY = (k: string) => k.startsWith('body.') && k !== 'body.legs';

/** p0 split for A13: the face part (local 美體 neutral) and the body part (neutral face, p0's local 美體) */
function splitBodyLook(p: PersonParams): { face: PersonParams; body: PersonParams } {
  const n = neutralPerson();
  const faceValues = { ...p.values };
  const bodyValues = { ...n.values };
  for (const k of Object.keys(p.values) as (keyof PersonParams['values'])[]) {
    if (!LOCAL_BODY(k)) continue;
    faceValues[k] = n.values[k];
    bodyValues[k] = p.values[k];
  }
  return { face: { ...p, values: faceValues }, body: { ...n, values: bodyValues } };
}

/**
 * The first definite answer of a photo's face detection (S §3.3 item 4): the cache, and the mapping every stored edit
 * goes through (assignPersons / renamePersons, applied to the current edit and to every undo state).
 * - primary: a camera seed's face (C2: a seed in no padded box → the score primary, and p0 is discarded); for a
 *   migrated v1 body, the person owning b0 (A13); else the best score;
 * - A13: when b0 pairs with no face, its person keeps p0's nine local 美體 values and the face primary gets the face part;
 * - a dropped cache is rematched by face-box IoU (S §5.3).
 */
export function firstAnswer(a: AnswerInput): Answer {
  const scans: DetectionCache['faceScans'] = a.prepared ? [{ quarter: 0, flipH: false }] : [];
  let cache: DetectionCache;
  if (a.detect && a.prepared) cache = withFaces(a.detect, a.prepared, scans);
  else if (a.prepared || a.v1Body?.bodies.length) {
    cache = buildCache(a.size, a.prepared ?? EMPTY_PREPARED, a.v1Body?.bodies ?? null, { faceScans: scans, bodiesComplete: a.v1Body?.complete ?? true });
  } else cache = { ...noFaceCache(a.size.width, a.size.height, scans), bodies: a.v1Body ? [] : null };
  const ids = cache.persons.map((p) => p.id);
  let discardP0 = false;
  if (a.faceSeed && a.faceSeed !== 'all') {
    const f = seedPrimary(a.faceSeed, cache.faces);
    const owner = f ? cache.persons.find((p) => p.face === f) : undefined;
    if (owner) cache = { ...cache, primary: owner.id };
    else discardP0 = true;
  }
  const b0 = a.v1Body?.bodies.length ? cache.persons.find((p) => p.body === 'b0') : undefined;
  if (b0 && b0.face !== null) cache = { ...cache, primary: b0.id };
  const split = !!b0 && b0.face === null && cache.faces.length > 0;
  if (b0 && !split && b0.face === null) cache = { ...cache, primary: b0.id };
  const primary = cache.primary;
  let rename: Record<PersonId, PersonId | null> | null = null;
  if (a.rematch) rename = rematchByIoU(a.rematch, cache);
  const rebase = (e: EditState): EditState => {
    let out = rename ? renamePersons(e, rename) : e;
    if (split && b0) {
      const look = splitBodyLook(out.persons.p0 ?? out.primaryInit ?? out.template);
      out = assignPersons(out, ids, primary, { discardP0 });
      out = withPersons(out, [primary], () => look.face);
      return withPersons(out, [b0.id], () => look.body);
    }
    return assignPersons(out, ids, primary, { discardP0 });
  };
  return { detect: cache, rebase, dropped: a.rematch !== null };
}
```

`firstAnswer` consumes the source's one-shot inputs (`v1Body`, `rematch`, `faceSeed`): the Editor passes them only with the photo's first answer and `null` afterwards (a 基本模式 cache gaining faces later, A15), or the A13 split would run a second time on persons that no longer hold `p0`.

- [ ] **Step 3: Editor helpers (append to `src/ui/editorModel.ts`) and their tests**

```ts
/** a cached body as the v1 BodyDetection measureBody reads */
export function bodyDetectionOf(cache: DetectionCache, bodyId: string): BodyDetection | null {
  const b = cache.bodies?.find((x) => x.id === bodyId);
  return b ? { pose: b.pose, mask: b.mask, people: cache.bodies!.length, width: cache.width, height: cache.height } : null;
}

/** every body person measured with its PAIRED face, or none (fixes the v0.3 group-photo bug, S §1.4, P4) */
export function measurePersons(
  cache: DetectionCache | null,
  faceOf: (faceId: string) => Face | null,
  measure: (d: BodyDetection, f: Face | null) => BodyMeasure,
  onError: (e: unknown) => void,
): Map<PersonId, BodyMeasure> {
  const out = new Map<PersonId, BodyMeasure>();
  if (!cache?.bodies) return out;
  for (const p of cache.persons) {
    if (!p.body) continue;
    const det = bodyDetectionOf(cache, p.body);
    if (!det) continue;
    try {
      out.set(p.id, measure(det, p.face ? faceOf(p.face) : null));
    } catch (e) {
      onError(e);
    }
  }
  return out;
}

/** the 長腿 anchor (S §4.6): legsAnchor with a body, else the primary with a body, else the best-scoring body person */
function legsAnchorOf(edit: EditState, cache: DetectionCache, measures: ReadonlyMap<PersonId, BodyMeasure>): PersonId | null {
  const a = edit.photo.legsAnchor;
  if (a && measures.has(a)) return a;
  if (measures.has(cache.primary)) return cache.primary;
  let best: PersonId | null = null;
  let score = -Infinity;
  for (const p of cache.persons) {
    const b = p.body ? cache.bodies?.find((x) => x.id === p.body) : undefined;
    if (b && measures.has(p.id) && b.score > score) {
      score = b.score;
      best = p.id;
    }
  }
  return best;
}

export function fieldInputOf(edit: EditState, cache: DetectionCache | null, measures: ReadonlyMap<PersonId, BodyMeasure>, aspect: number): BodyFieldInput {
  const LOCAL = paramsInGroup('body').filter((d) => d.id !== 'body.legs');
  const band = edit.photo.heightBand;
  // with 增高 / 長腿 on, every body person carries today's hands-rigid term (it rides with the bands)
  const bandsOn = (!!band && band.amount > 0 && band.bottom > band.top) || edit.photo.values['body.legs'] > 0;
  const edited: BodyPersonInput[] = [];
  for (const [id, m] of measures) {
    const v = personOf(edit, id).values;
    const values = Object.fromEntries(LOCAL.map((d) => [d.id, v[d.id as keyof typeof v]])) as BodyPersonInput['values'];
    if (bandsOn || LOCAL.some((d) => hasValue(d, values[d.id as keyof typeof values]))) edited.push({ id, measure: m, values });
  }
  const masks = cache?.bodies
    ? cache.persons.flatMap((p) => {
        const b = p.body ? cache.bodies!.find((x) => x.id === p.body) : undefined;
        return b?.mask ? [{ id: p.id, mask: b.mask }] : [];
      })
    : [];
  const anchor = cache ? legsAnchorOf(edit, cache, measures) : null;
  return { edited, masks, heightBand: edit.photo.heightBand, legs: { value: edit.photo.values['body.legs'], measure: anchor ? measures.get(anchor)! : null }, bodyProtect: edit.photo.bodyProtect, aspect };
}

/** the session faces with their persons (cache links) for buildFrame */
export function frameFacesOf(cache: DetectionCache | null, faces: readonly SessionFace[]): FrameFaceIn[] {
  return faces.map((f) => ({ id: f.id, face: f.face, person: cache?.persons.find((p) => p.face === f.id)?.id ?? null }));
}

/** one 瘦臉-limit request per face (F1): its person's contour, its paired pose mask, the other faces / obstacles / persons */
export function protectRequests(cache: DetectionCache, faces: readonly SessionFace[], edit: EditState, size: { width: number; height: number }): ProtectRequest[] {
  const centre = (b: Rect): [number, number] => [b.x + b.w / 2, b.y + b.h / 2];
  return faces.map((f) => {
    const person = cache.persons.find((p) => p.face === f.id);
    const pose = person?.body ? (cache.bodies?.find((b) => b.id === person.body)?.mask ?? null) : null;
    const others = faces.filter((g) => g.id !== f.id);
    const otherMasks = cache.persons.flatMap((p) => {
      if (p.id === person?.id || !p.body) return [];
      const m = cache.bodies?.find((b) => b.id === p.body)?.mask;
      return m ? [m] : [];
    });
    return {
      id: f.id,
      face: f.face,
      contour: !!person && contourActiveValues(personOf(edit, person.id).values),
      pose,
      others: {
        otherCentres: [...others.map((g) => centre(g.box)), ...cache.obstacles.map((o) => centre(o.box))],
        otherOvals: [...others.map((g) => g.face.oval), ...cache.obstacles.map((o) => o.oval)],
        otherMasks,
        window: faces.length >= 2 ? protectWindow(f.face, size.width, size.height) : null,
      },
    };
  });
}

/**
 * A detection-driven rebase (assignPersons, withBodies, the p0 hand-over, renamePersons) is not an edit (U2): when the
 * output of `prevKey` was saved, the stamp follows the edit to `nextKey` with its field generation, so the autosave does
 * not fire for it; an output that was not saved stays unsaved.
 */
export function rebaseStamp(saved: OutputStamp | null, prevKey: string, nextKey: string, field: number): OutputStamp | null {
  return saved && stampIs(saved, prevKey, field) ? { key: nextKey, field: saved.field } : saved;
}
```

Imports: `personOf` (`../edit/state`), `type FrameFaceIn` (`../edit/frame`), `type BodyFieldInput, type BodyPersonInput` (`../body/field`), `contourActiveValues, type ProtectRequest` (`./faceProtectModel`), `protectWindow` (`../tracking/faceProtect` — a pure module, no tasks-vision), `type SessionFace` (`../app/still`), `hasValue, paramsInGroup` (`../engine/params`, merged into the existing import), types `DetectionCache, EditState, PersonId, Rect`.

Tests (append to `src/ui/editorModel.test.ts`):

```ts
describe('persons in the editor model (S §3.3)', () => {
  const cache = makeCache({ bodies: [cacheBody('b0', 0.3), cacheBody('b1', 0.7)], persons: [{ id: 'f0', face: 'f0', body: 'b0' }, { id: 'f1', face: 'f1', body: null }, { id: 'b1', face: null, body: 'b1' }] });
  it('each body person is measured with its paired face, or none', () => {
    const seen: [number, boolean][] = [];
    const ms = measurePersons(cache, () => FACE, (d, f) => (seen.push([d.pose.points[0], f !== null]), {} as BodyMeasure), () => undefined);
    expect([...ms.keys()]).toEqual(['f0', 'b1']);
    expect(seen.map(([, f]) => f)).toEqual([true, false]);
  });
  it('fieldInputOf lists only persons with a body and a non-neutral local item; 長腿 anchors on the primary with a body', () => {
    const m0 = {} as BodyMeasure;
    const m1 = {} as BodyMeasure;
    const e = lensFor(assignPersons(editFromLegacy(applyPreset('natural', 1)), ['f0', 'f1', 'b1'], 'f0'), { kind: 'person', id: 'b1' }, personInfos(cache), 'f0').set('body.waist', 0.5);
    const i = fieldInputOf(e, cache, new Map([['f0', m0], ['b1', m1]]), 0.75);
    expect(i.edited.map((p) => p.id)).toEqual(['b1']);
    expect(i.legs.measure).toBe(m0);
    // 長腿 on: every body person rides along (hands-rigid term), as one person did in v0.3
    const legs = { ...e, photo: { ...e.photo, values: { ...e.photo.values, 'body.legs': 0.3 } } };
    expect(fieldInputOf(legs, cache, new Map([['f0', m0], ['b1', m1]]), 0.75).edited.map((p) => p.id)).toEqual(['f0', 'b1']);
  });
  it('frameFacesOf links faces to persons; protectRequests: windows with ≥ 2 faces and the others’ ovals', () => {
    const faces = [{ id: 'f0', face: makeFace(0, 0.3), box: cache.faces[0].box, lm: cache.faces[0].lm }, { id: 'f1', face: makeFace(1, 0.7), box: cache.faces[1].box, lm: cache.faces[1].lm }];
    expect(frameFacesOf(cache, faces).map((f) => f.person)).toEqual(['f0', 'f1']);
    const r = protectRequests(cache, faces, assignPersons(editFromLegacy(applyPreset('natural', 1)), ['f0', 'f1', 'b1'], 'f0'), { width: 1600, height: 1200 });
    expect(r[0].others.otherOvals).toHaveLength(1);
    expect(r[0].others.window).not.toBeNull();
    expect(r[0].contour).toBe(true);
  });
  it('rebaseStamp: a saved output stays saved across a detection-driven rebase; an unsaved one stays unsaved (U2, S §8.1)', () => {
    const saved = { key: 'a', field: ANY_FIELD };
    expect(rebaseStamp(saved, 'a', 'b', 3)).toEqual({ key: 'b', field: ANY_FIELD });
    expect(stampIs(rebaseStamp(saved, 'a', 'b', 3), 'b', 7)).toBe(true);
    expect(rebaseStamp({ key: 'x', field: 2 }, 'a', 'b', 2)).toEqual({ key: 'x', field: 2 });
    expect(rebaseStamp(null, 'a', 'b', 0)).toBeNull();
  });
});
```

(imports: `fieldInputOf, frameFacesOf, measurePersons, protectRequests, rebaseStamp` from `./editorModel` (`ANY_FIELD`, `stampIs` are imported already); `makeCache, cacheBody` from `../detect/testCaches`; `personInfos` from `../detect/cache`; `lensFor` from `../edit/lens`; `assignPersons` from `../edit/state`; `editFromLegacy` from `../edit/legacy`; `makeFace` added to the `../app/testFakes` import. `FACE` is the file's existing `{} as Face` constant, `:31`.)

The history half of S §8.1's editorModel row (the writes the editor's `rebaseOnDetect` makes, Step 4 item 4, never reorder 最近編輯), appended to `src/store/history.test.ts` (it has the fake-indexeddb scaffolding; imports: `openState` from `../edit/migrate`, `assignPersons, renamePersons` from `../edit/state`, `legacyProjection` from `../edit/legacy`, `withBodies` from `../detect/cache`, `makeCache, cacheBody` from `../detect/testCaches`, `sanitizeParams` added to the `../engine/params` import, `stableKey` from `./undo`, types `DetectionCache, EditState`):

```ts
describe('detection-driven writes keep 最近編輯 (S §5.2, A17)', () => {
  it('reopening a v1 entry, assigning its persons and adding bodies changes neither the order nor updatedAt', async () => {
    const older = await addEntry(entry('older'));
    await addEntry(entry('newer'));
    const before = (await listEntries()).map((e) => [e.id, e.updatedAt]);
    const opened = openState((await getEntry(older))!, { width: 1536, height: 2048 });
    /** the patch rebaseOnDetect writes */
    const write = async (edit: EditState, detect: DetectionCache) => {
      const params = sanitizeParams(legacyProjection(edit, detect.primary));
      await updateEntry(older, { schema: 2, edit, params, paramsKey: stableKey(params), detect }, { touch: false });
    };
    const cache = makeCache({ width: 1536, height: 2048 });
    const assigned = assignPersons(opened.edit, cache.persons.map((p) => p.id), cache.primary);
    await write(assigned, cache);
    const r = withBodies(cache, [{ pose: cacheBody('x', 0.95).pose, mask: null, score: 0.1 }], () => null);
    await write(assignPersons(renamePersons(assigned, r.renamed), r.cache.persons.map((p) => p.id), r.cache.primary), r.cache);
    expect((await listEntries()).map((e) => [e.id, e.updatedAt])).toEqual(before);
    expect((await getEntry(older))!.detect?.bodies).toHaveLength(1);
  });
});
```

Run: `npx vitest run src/edit src/ui/editorModel.test.ts src/store/history.test.ts`
Expected: PASS.

- [ ] **Step 3b: The editor's fold safety net for summed face warps (S §4.4 last bullet)**

The caps make the summed map fold-free in every swept layout (Task 16), so this guard should never act; S §4.4 still asks for it, so a commit can never ship a fold. Write the failing test `src/edit/warpGuard.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ovalBox } from '../engine/passes/faceCap';
import { adapt } from '../tracking/adapter111';
import type { Face, StillFrame } from '../types';
import { defaultPhoto, personFromPreset } from './state';
import { warpGuard } from './warpGuard';

const lm = JSON.parse(readFileSync(new URL('../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as { width: number; height: number; points: number[] };
const base = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);
const aspect = lm.width / lm.height;
/** the fixture face shrunk by k about its oval centre and moved by dx */
const at = (k: number, dx: number): Face => {
  const b = ovalBox(base);
  const c = [b.x + b.w / 2, b.y + b.h / 2];
  const m = (a: Float32Array) => a.map((v, i) => (i % 2 === 0 ? c[0] + (v - c[0]) * k + dx : c[1] + (v - c[1]) * k));
  return { pts111: m(base.pts111), ext: m(base.ext), oval: m(base.oval), yaw: base.yaw };
};
const strong = (() => {
  const p = personFromPreset('original', 1);
  return { ...p, values: { ...p.values, 'shape.faceSlim': 1, 'shape.faceV': 1, 'shape.eyeEnlarge': 1 } };
})();
const frameOf = (faces: Face[], warpScale: number[] = []): StillFrame => ({
  faces: faces.map((face, i) => ({ face, weight: 1, person: strong, protect: null, warpScale: warpScale[i] ?? 1 })),
  obstacles: [],
  globalSkin: null,
  photo: defaultPhoto(),
});

describe('warpGuard (S §4.4 editor safety net)', () => {
  const pair = [at(0.45, -0.2), at(0.45, 0.2)];
  it('never acts at MIN_DET: two capped faces with every contour item and 大眼 at max keep λ = 1', () => {
    expect(warpGuard(frameOf(pair), aspect)).toEqual([1, 1]);
  });
  it('one face (no cap) is never guarded', () => {
    expect(warpGuard(frameOf([pair[0]]), aspect, { minDet: 0.99 })).toEqual([1]);
  });
  it('a stricter bound bisects λ_f per capped face, and the guarded table meets it', () => {
    const l = warpGuard(frameOf(pair), aspect, { minDet: 0.97 });
    expect(l.some((x) => x < 1)).toBe(true);
    for (const x of l) expect(x >= 0 && x <= 1).toBe(true);
    expect(warpGuard(frameOf(pair, l), aspect, { minDet: 0.97 })).toEqual([1, 1]);
  });
});
```

Run: `npx vitest run src/edit/warpGuard.test.ts`
Expected: FAIL (cannot resolve `./warpGuard`).

`src/types.ts` (CRLF), `RenderFace`: after `protect` add `/** λ_f of the editor's fold safety net (S §4.4): multiplies this face's warp strengths only; absent = 1 */ warpScale?: number;`.

`src/engine/index.ts` (CRLF) `job()`: `reshape: reshapeUniforms(f.person.values, w),` → `reshape: scaleUniforms(reshapeUniforms(f.person.values, w), f.warpScale ?? 1),` with, above `createEngine`,

```ts
/** λ_f (S §4.4): every warp strength × k; k = 1 returns `u` itself, so the unguarded table is bit-identical */
function scaleUniforms(u: ReshapeUniforms, k: number): ReshapeUniforms {
  if (k === 1) return u;
  const o = { ...u };
  for (const key of Object.keys(o) as (keyof ReshapeUniforms)[]) o[key] *= Math.min(1, Math.max(0, k));
  return o;
}
```

(import `type ReshapeUniforms` with `reshapeUniforms` from `./passes/reshape`).

`src/edit/frame.ts` `buildFrame`: a sixth parameter `warpScales: ReadonlyMap<string, number> = new Map()`; each listed face gets `warpScale: warpScales.get(f.id) ?? 1`. (Task 18's `buildFrame` test passes five arguments and keeps passing; `toEqual` there compares the fields it names.)

`src/engine/passes/reshapeCpu.ts`: the header's "Never imported by the app" becomes "Imported by the app only for the editor's fold safety net (src/edit/warpGuard.ts, on slider commits)"; append

```ts
/** smallest forward-difference Jacobian determinant of `map` on an n × n grid over `box` (UV); −∞ on a non-finite value */
export function mapMinDet(map: UvMap, box: readonly [number, number, number, number], n = 65): number {
  let min = Infinity;
  const hx = (box[2] - box[0]) / (n - 1);
  const hy = (box[3] - box[1]) / (n - 1);
  for (let j = 0; j + 1 < n; j++) {
    for (let i = 0; i + 1 < n; i++) {
      const x = box[0] + i * hx;
      const y = box[1] + j * hy;
      const a = map(x, y);
      const bx = map(x + hx, y);
      const by = map(x, y + hy);
      if (![...a, ...bx, ...by].every(Number.isFinite)) return -Infinity;
      min = Math.min(min, ((bx[0] - a[0]) / hx) * ((by[1] - a[1]) / hy) - ((bx[1] - a[1]) / hx) * ((by[0] - a[0]) / hy));
    }
  }
  return min;
}
```

`src/edit/warpGuard.ts`:

```ts
// The editor's fold safety net for summed face warps (S §4.4 last bullet): on a slider commit with ≥ 2 capped faces,
// the CPU port of the reshape pass checks min det J on a 65 × 65 grid over each capped face's influence box. Below the
// bound (MIN_DET; the caps make that impossible in every swept layout, so this should never act) a per-face strength
// scale λ_f is bisected in 6 steps, as buildBodyField does (field.ts:148-160), and multiplies that face's warp strengths
// in the table (RenderFace.warpScale) until the next change. The cap shape is never changed for this.
import { MIN_DET } from '../body/field';
import { attenuate, boxCentre, capsFor, faceDrawn, influenceBox, ovalBox, WHOLE, type TableFace } from '../engine/passes/faceCap';
import { reshapeActive, reshapeUniforms, type ReshapeUniforms } from '../engine/passes/reshape';
import { mapMinDet, reshapeMapMulti } from '../engine/passes/reshapeCpu';
import type { FaceProtect, StillFrame } from '../types';

const scaled = (u: ReshapeUniforms, k: number): ReshapeUniforms => {
  const o = { ...u };
  for (const key of Object.keys(o) as (keyof ReshapeUniforms)[]) o[key] *= k;
  return o;
};

/** λ_f per frame face (1 = untouched), the table built exactly as the engine's job() + tableFaces build it */
export function warpGuard(frame: StillFrame, aspect: number, opts: { minDet?: number; grid?: number; steps?: number } = {}): number[] {
  const minDet = opts.minDet ?? MIN_DET;
  const n = opts.grid ?? 65;
  const steps = opts.steps ?? 6;
  const lambda = frame.faces.map(() => 1);
  const centres = frame.faces.map((f) => boxCentre(ovalBox(f.face)));
  const caps = capsFor(centres, frame.obstacles ?? [], aspect, frame.faces.map((f) => f.presence ?? 1));
  const protects: FaceProtect[] = [];
  const base: TableFace[] = frame.faces.map((f, i) => {
    const w = Number.isFinite(f.weight) ? Math.min(1, Math.max(0, f.weight)) : 0;
    const raw = scaled(reshapeUniforms(f.person.values, w), Math.min(1, Math.max(0, f.warpScale ?? 1)));
    const u = w > 0 && reshapeActive(raw) ? attenuate(raw, f.face.yaw) : scaled(raw, 0);
    let layer = -1;
    if (f.protect && faceDrawn(u)) {
      layer = protects.length;
      protects.push(f.protect);
    }
    return { face: f.face, u, layer, window: f.protect?.window ?? WHOLE, centre: centres[i], cap: caps[i] };
  });
  const capped = base.flatMap((t, i) => (t.cap >= 0 && faceDrawn(t.u) ? [i] : []));
  if (capped.length < 2) return lambda;
  const table = () => base.map((t, i) => (lambda[i] === 1 ? t : { ...t, u: scaled(t.u, lambda[i]) }));
  for (const i of capped) {
    const box = influenceBox(base[i], aspect);
    if (box[0] > box[2] || box[1] > box[3]) continue;
    const ok = () => mapMinDet(reshapeMapMulti(table(), aspect, { protects }), box, n) >= minDet;
    if (ok()) continue;
    let lo = 0;
    let hi = 1;
    for (let s = 0; s < steps; s++) {
      const m = (lo + hi) / 2;
      lambda[i] = m;
      if (ok()) lo = m;
      else hi = m;
    }
    lambda[i] = lo;
  }
  return lambda;
}
```

Run: `npx vitest run src/edit/warpGuard.test.ts src/engine src/edit/frame.test.ts`
Expected: PASS (the first case logs nothing: λ = 1, the guard did not act).

- [ ] **Step 4: The editor (`src/ui/screens/Editor.tsx`)**

Replace the interim pieces of Tasks 12, 18 and 19 with the person model. Exact edits:

1. Imports: `firstAnswer` (`../../edit/migrate`), `buildFrame` (`../../edit/frame`, drop `legacyFrame`), `assignPersons, renamePersons` (`../../edit/state`), `personInfos, scanned0, withBodies` (`../../detect/cache`, drop `boxScore`, `primaryBody`), `buildBodyField` (`../../body/field`, drop `buildBodyFieldV1`), `BodyFieldMemo` (drop `BodyFieldMemoV1`), `bodyDetectionOf, fieldInputOf, frameFacesOf, measurePersons, protectRequests, rebaseStamp` (`../editorModel`); `warpGuard` (`../../edit/warpGuard`); `sanitizeParams` (`../../engine/params`), `stableKey` (`../../store/undo`); types `DetectionCache, Selection`.
2. Persons state (after the edit state from Task 12, replacing `const primary: PersonId = P0;` and `lensOf`):

```tsx
  /** the photo's detection cache (persons, faces, bodies); null until the first definite face answer */
  const [detect, setDetectState] = useState<DetectionCache | null>(source.detect);
  const detectRef = useRef(detect);
  const setDetect = (d: DetectionCache) => {
    detectRef.current = d;
    setDetectState(d);
  };
  const primary: PersonId = detect?.primary ?? P0;
  const infos = useMemo(() => personInfos(detect), [detect]);
  /** sub-step 1c: the selection is the primary (Task 23 adds the strip, the boxes and 全部) */
  const selection: Selection = { kind: 'person', id: primary };
```

`lensOf(e)` becomes `lensFor(e, selection, infos, primary, { available: (p, id) => { const m = measuresRef.current.get(p); return !m || paramAvailability(m, id).ok; } })` (declare it after `measuresRef` below). The `params` / `paramsRef` projection of Task 12 becomes `const params = useMemo(() => legacyProjection(edit, primary), [edit, primary]);` and is read by `shouldDetectBody` only (item 6); every engine, export, field and limit use switches to `edit` / `frameOf` (items 7–9), `contourActive(params)` disappears with the interim protect effect, and `useFilterLoader(…, edit.photo.filterId)`.
3. Session creation (the effect at `:191-256`): replace the `known` logic with

```tsx
        const cache = detectRef.current;
        const useCache = cache !== null && (!tracker || scanned0(cache));
        const { s, unsure } = detectSession(!!tracker, () => svc.get().tracker === 'ok', () =>
          deps.createStillSession(target, tracker, source.bitmap, {
            ownsBitmap: false,
            faces: useCache ? cache.faces : undefined,
            obstacles: useCache ? cache.obstacles : undefined,
            body: fieldMemo.field,
          }),
        );
        if (!useCache && (!tracker || !unsure)) {
          // the source's one-shot inputs ride with the photo's first answer only
          const first = !answered.current;
          answered.current = true;
          applyAnswer(
            firstAnswer({
              detect: cache,
              prepared: tracker ? { faces: [...s.faces], obstacles: [...s.obstacles], dropped: s.dropped } : null,
              size: photo,
              v1Body: first ? source.v1Body : null,
              rematch: first ? source.rematch : null,
              faceSeed: first ? source.faceSeed : null,
            }),
            first,
          );
        }
```

with `const answered = useRef(source.detect !== null);` declared next to `detectRef`. A fitting cache that lost persons in `normalizeDetect` (`source.detect !== null && source.cacheDropped`, openState's `detectLost` path) gets no answer, so its toast shows once at mount: `useEffect(() => { if (source.detect && source.cacheDropped) toast('已重新偵測臉部，部分人物的設定已重設', 3200); }, []);` (S §5.4: "a person … left with neither face nor body is dropped, and the cache-dropped toast shows"). Keep the existing `sessionRef` / `setBound`; the no-face toast now shows only for a fresh answer, `if (tracker && !unsure && !useCache && !s.faces.length) toast('未偵測到臉部，僅套用美膚與濾鏡', 3200)` (a reopened no-face photo shows no toast, S §8.4); delete `knownFaces` and the `fresh` / `saved` reset of the interim (the answer's `rebaseOnDetect` handles "saved"). This reproduces `source.needsFaceDetect` (openState's flag) without reading it: a fitting cache with an upright answer is used as is, anything else detects once a tracker allows.
4. `applyAnswer` and the detection-driven write (A17), declared before the session effect:

```tsx
  /** a detection changed the persons: rebase every stored state, keep "saved" saved, write the cache without reordering */
  const rebaseOnDetect = (fn: (e: EditState) => EditState, cache: DetectionCache) => {
    const prev = editRef.current;
    const next = fn(prev);
    try {
      undo?.rebase(fn);
    } catch (e) {
      reportError(e, 'undo.rebase');
    }
    editRef.current = next;
    setEditState(next);
    setDetect(cache);
    // the persons changed: the safety net's λ_f (item 13) belonged to the old table
    warpScales.current = new Map();
    // bodies already known (a v2 cache, or a v1 entry's complete b0): the 美體 tab needs no pose model
    if (cache.bodies && cache.bodiesComplete && bodyDetRef.current.phase !== 'done') setBodyDet({ phase: 'done', det: null });
    // not an edit (U2): a saved output stays saved, so the autosave does not fire for it
    saved.current = rebaseStamp(saved.current, editKey(prev), editKey(next), fieldGen.current);
    historyChain.current = historyChain.current
      .then(async () => {
        const id = historyId.current;
        if (!id) return; // the addEntry that creates the entry carries `detect`
        const params = sanitizeParams(legacyProjection(next, cache.primary));
        await deps.updateEntry(id, { schema: 2, edit: next, params, paramsKey: stableKey(params), detect: cache }, { touch: false });
      })
      .catch((e: unknown) => reportError(e, 'history detect'));
    setPendingHistory(historyChain.current);
  };
  /** v1 group photos re-render on another face than 0.3's faces[0]: a fresh thumbnail, also without reordering */
  const thumbOwed = useRef(false);
  const applyAnswer = (a: ReturnType<typeof firstAnswer>, first: boolean) => {
    rebaseOnDetect(a.rebase, a.detect);
    if (!first) return;
    // a v1 entry (primaryInit set by openState) with ≥ 2 faces: 0.3 drew faces[0], 0.4 draws the primary
    if (source.historyId && source.edit.primaryInit && a.detect.faces.length >= 2) thumbOwed.current = true;
    if (a.dropped || source.cacheDropped) toast('已重新偵測臉部，部分人物的設定已重設', 3200);
  };
```

`rebaseOnDetect` runs before `bodyDetRef` / `setBodyDet` are declared in the file order of today's component: declare it (and `applyAnswer`) below the 美體 state block (`:113-134`), which still comes before the session effect.

5. History writes: `writeHistory`'s `addEntry({… })` adds `...(detectRef.current ? { detect: detectRef.current } : {})`; `writeParams`/`addEntry` use `paramsPatch(e, detectRef.current?.primary ?? P0, …)`. Delete `persistBody`, `bodyStored`, `bodyToPersist` uses and the history body-cache read effect (`:419-443`).
6. Bodies (replacing `:113-134` and `:445-468`): the body status comes from the cache:

```tsx
  const [bodyDet, setBodyDetState] = useState<BodyDet>(() =>
    source.detect?.bodies && source.detect.bodiesComplete ? { phase: 'done', det: null } : { phase: 'idle' },
  );
```

`startBodyDetection`'s success handler:

```tsx
      (dets) => {
        if (dets === undefined || unmounted.current) return;
        const cache = detectRef.current;
        if (!cache) return;
        const s = sessionRef.current;
        const faceOf = (id: string) => s?.faces.find((f) => f.id === id)?.face ?? null;
        const r = withBodies(cache, dets?.bodies ?? [], faceOf);
        const ids = r.cache.persons.map((p) => p.id);
        rebaseOnDetect((e) => assignPersons(renamePersons(e, r.renamed), ids, r.cache.primary), r.cache);
        setBodyDet({ phase: 'done', det: null });
      },
```

and the trigger effect (`:473-477`) adds `&& detectRef.current !== null` to the `shouldDetectBody(…)` condition and keeps passing `params` (item 2: the projection on the primary; the v1 helper only checks whether some 美體 value of it is set). `BodyDet.done.det` is now unused for detection data: `bodyPanelContext` gets the primary person's detection — replace its first argument with `bodyDet.phase === 'done' ? { phase: 'done', det: detect && personBody ? bodyDetectionOf(detect, personBody) : null } : bodyDet` where `const personBody = detect?.persons.find((p) => p.id === primary)?.body ?? detect?.bodies?.[0]?.id ?? null;`.
7. Measures and the field (replacing `:479-488` and the field memo):

```tsx
  const [fieldMemo] = useState(() => new BodyFieldMemo(buildBodyField));
  const sessionFaces = session?.faces ?? null;
  const facesRef = useRef(sessionFaces);
  if (sessionFaces) facesRef.current = sessionFaces;
  const measures = useMemo(
    () => measurePersons(detect, (id) => facesRef.current?.find((f) => f.id === id)?.face ?? null, measureBody, (e) => reportError(e, 'measureBody')),
    [detect, sessionFaces],
  );
  const measuresRef = useRef(measures);
  measuresRef.current = measures;
  const measure = measures.get(primary) ?? null;
```

`applyField(draft)`: `fieldMemo.update(fieldInputOf(editRef.current, detectRef.current, measuresRef.current, bodyAspect), draft)`; the field effect's dependencies `[measure, params]` → `[measures, edit]` and `fieldDraft.next(measure)` → `fieldDraft.next(measures)`.
8. The 瘦臉 limits (replacing the interim protect effect):

```tsx
  const [protects, setProtects] = useState<ReadonlyMap<string, FaceProtect>>(new Map());
  const protectsRef = useRef(protects);
  protectsRef.current = protects;
  useEffect(() => {
    if (!session || !detect) return;
    const next = protectSrc.updateAll(protectRequests(detect, session.faces, edit, photo), limitRequested);
    const same = next.size === protectsRef.current.size && [...next].every(([k, v]) => protectsRef.current.get(k) === v);
    if (same) return;
    protectsRef.current = next;
    setProtects(next);
    fieldGen.current++;
    setFieldTick((n) => n + 1);
  }, [session, detect, edit, protectTick, limitRequested]);
```

`limitRecord`: `protectSrc.record(protectsRef.current)`.
9. Frames (replacing `frameOf`):

```tsx
  const frameOf = (e: EditState) => {
    const d = detectRef.current;
    const s = sessionRef.current;
    return buildFrame(e, frameFacesOf(d, s?.faces ?? []), d?.obstacles ?? [], protectsRef.current, d?.primary ?? P0, warpScales.current);
  };
```

Render effect: `session.render(frameOf(edit))` with dependencies `[session, edit, protects, detect]`. `encode(s, e, field)` takes the `EditState` and exports `frameOf(e)`; every `prepareExport` / `exportReady` / `exportImageData` call passes `frameOf(e)` for the edit it exports (`flushHistory`: `editRef.current`; the encode effect and `save`: `edit`). `useFilterLoader(…, edit.photo.filterId)`.
10. The owed thumbnail: in the encode effect (`:626-669`), between the fresh-encode block and `if (unmounted.current || stampIs(saved.current, key, gen) || sessionRef.current !== s) return;` (`:653`), add (the output of a viewed, already-saved v1 entry is exported anyway for the share cache; its thumbnail is rewritten once, without reordering 最近編輯):

```tsx
      if (img && current() && thumbOwed.current && historyId.current && stampIs(saved.current, key, gen)) {
        thumbOwed.current = false;
        const id = historyId.current;
        const shot = img;
        historyChain.current = historyChain.current
          .then(async () => deps.updateEntry(id, { thumb: await deps.toJpegBlob(shot, THUMB_EDGE, 0.82) }, { touch: false }))
          .catch((e: unknown) => reportError(e, 'history thumb'));
        setPendingHistory(historyChain.current);
      }
```

11. `faceNote`: `if (session && !session.faces.length)` stays; debug: in the render effect also set `debug({ persons: infos.length, faces: session.faces.length, selected: primary })` (the `ui/debug.ts` `debug()` helper).
12. `src/ui/state.ts`: delete `EditorSource.body`; `src/ui/flows.ts`: delete `if (entry.body !== undefined) source.body = entry.body;`. Delete the imports this leaves unused in `Editor.tsx` (`measureSafe`, `cachedBodyFits`, `bodyToPersist`, the `BodyDetection` type, `contourActive`); `noUnusedLocals` makes `npm run typecheck` list any that remain.
13. The fold safety net (S §4.4; Step 3b), declared with the other refs above `update`:

```tsx
  /** λ_f per face id from the last commit (S §4.4): reset by the next change, recomputed on every commit */
  const warpScales = useRef<ReadonlyMap<string, number>>(new Map());
  /** on a commit with ≥ 2 faces: the CPU port checks the summed map; an empty map whenever the guard does not act */
  const guardScales = (e: EditState): ReadonlyMap<string, number> => {
    const s = sessionRef.current;
    const d = detectRef.current;
    if (!s || !d || s.faces.length < 2) return new Map();
    try {
      const frame = buildFrame(e, frameFacesOf(d, s.faces), d.obstacles, protectsRef.current, d.primary);
      const lambda = warpGuard(frame, photo.width / Math.max(1, photo.height));
      const out = new Map<string, number>();
      s.faces.forEach((f, i) => {
        if (lambda[i] < 1) out.set(f.id, lambda[i]);
      });
      // it should never act (the caps keep the sum fold-free): say so in the console, but never as an error
      if (out.size) console.warn('[meiyan] warp guard scaled faces', Object.fromEntries(out));
      return out;
    } catch (err) {
      reportError(err, 'warpGuard');
      return new Map();
    }
  };
```

In `update(e, commit)` (Task 12), before `setEditState(e)`: `warpScales.current = commit ? guardScales(e) : new Map();` (a drag step draws the plain table; the commit checks it). In `doUndo` / `doRedo`, before `setEditState(e)`: `warpScales.current = guardScales(e);` (an undo lands on another committed state). `guardScales`, `update` and `rebaseOnDetect` only read `protectsRef`, `warpScales` and `photo` when they run (from handlers and effects, after the first render), so their place in the component body is free; keep every `useRef` / `useState` at the top level.

- [ ] **Step 5: First persons e2e (`tests/e2e/persons.spec.ts`)**

Add helpers to `tests/e2e/fixtures.ts`:

```ts
export const GROUP_FACES = resolve(import.meta.dirname, '../fixtures/group_faces.png');
export const GROUP_PEOPLE = resolve(import.meta.dirname, '../fixtures/group_people.jpg');

/** import a fixture through the home screen's picker and wait for the editor */
export async function importFixture(page: Page, path: string): Promise<void> {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /匯入照片/ }).click();
  await (await chooser).setFiles(path);
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 90_000 });
  await expect.poll(async () => (await debugState(page)).screen).toBe('editor');
}

/**
 * Write a raw record straight into IndexedDB `meiyan` / `edits` (store/history.ts DB_NAME, STORE_NAME; v0.3-shaped or
 * v2), then reload. Call after `page.goto('/')` (same origin). `original` / `thumb` are fixture URLs fetched in the page.
 */
export async function seedHistory(page: Page, record: Record<string, unknown>): Promise<void> {
  await page.evaluate(async (r) => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const q = indexedDB.open('meiyan', 1);
      q.onupgradeneeded = () => q.result.createObjectStore('edits', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
    const blob = async (u: string) => (await fetch(u)).blob();
    const rec = { ...r, original: await blob(r.original as string), thumb: await blob(r.thumb as string) };
    await new Promise<void>((res, rej) => {
      const tx = db.transaction('edits', 'readwrite');
      tx.objectStore('edits').put(rec);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  }, record);
  await page.reload();
}

/** mean |a − b| inside `r` (fractions of the image) and the max outside it */
export function regionDiff(a: Pixels, b: Pixels, r: Rect): { inside: number; outsideMax: number } {
  const R = { x: Math.round(r.x * a.width), y: Math.round(r.y * a.height), w: Math.round(r.w * a.width), h: Math.round(r.h * a.height) };
  let outsideMax = 0;
  for (let y = 0; y < a.height; y++)
    for (let x = 0; x < a.width; x++) {
      if (x >= R.x && x < R.x + R.w && y >= R.y && y < R.y + R.h) continue;
      const i = (y * a.width + x) * 4;
      outsideMax = Math.max(outsideMax, Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));
    }
  return { inside: mad(a, b, R), outsideMax };
}
```

`tests/e2e/persons.spec.ts` (Task 23 appends the UI cases):

```ts
import { debugState, expect, GROUP_FACES, importFixture, test } from './fixtures';

test('a group photo: three selectable faces (D ignored), A is the primary, the cache is written', async ({ page }) => {
  await importFixture(page, GROUP_FACES);
  await expect.poll(async () => (await debugState(page)).faces).toBe(3);
  const d = await debugState(page);
  expect(d.persons).toBe(3);
  expect(d.selected).toBe('f0');
  expect(d.detectCalls).toBe(1);
});

test('reopening an edited group photo runs no face detector: the cache answers', async ({ page }) => {
  await importFixture(page, GROUP_FACES);
  await expect.poll(async () => (await debugState(page)).faces).toBe(3);
  await page.getByRole('tab', { name: '美型' }).click();
  await page.getByRole('option', { name: '大眼', exact: true }).click();
  await page.getByRole('slider').focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: '關閉' }).click();
  await expect(page.getByRole('button', { name: '開啟編輯' })).toHaveCount(1, { timeout: 15_000 });
  const calls = (await debugState(page)).detectCalls;
  await page.getByRole('button', { name: '開啟編輯' }).click();
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 60_000 });
  await expect.poll(async () => (await debugState(page)).faces).toBe(3);
  expect((await debugState(page)).detectCalls).toBe(calls);
});
```

- [ ] **Step 6: Sub-step 1c gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green.

Run: `npm run test:e2e`
Expected: every spec passes, including `parity.spec.ts` (max ≤ 1/255) and `persons.spec.ts`.

- [ ] **Step 7: Commit**

```bash
git add src tests/e2e
git commit -m "v0.4 step 1c: the editor on persons (cache, first answer, bodies, per-face limits, frames)"
```

---

## Sub-step 1d — Face boxes, person strip, 全部, per-tab notes, photo taps

### Task 22: The panel per person — notes, per-item gating, 「整張」, slider identity and labels

**Files:**
- Modify: `src/ui/panelModel.ts` (CRLF; `:62-91` BodyContext, `:93-94` BODY_MULTI_NOTE, `:143-145` bodyNote ready, the Task 10 `itemsFor` / `bodyItems` / `sliderFor`), `src/ui/panelModel.test.ts` (`:20`, `:264`, `:333-335` intended change #3, append), `src/ui/components/BeautyPanel.tsx` (CRLF), `src/ui/components/Slider.tsx` (CRLF, `:44-55`, `:143-181`), `src/ui/theme.css` (CRLF, append), `src/body/measure.ts:153-157` (comment, P6)

**Interfaces:**
- Consumes: `Lens`, `NO_FACE_NOTE`, `NO_BODY_NOTE` (Task 6), `paramDef(id).scope` (Task 4).
- Produces (`src/ui/panelModel.ts`):

```ts
export const PHOTO_BADGE = '整張';
export const PHOTO_SCOPE = '整張照片';
export const MIXED = '各人不同';
export const BANDS_NOTE = '增高、長腿會拉伸整排畫面，套用於整張照片';
export function legsAnchorNote(n: number): string;          // 長腿以人物 {n} 的腿長為準，套用於整張照片
export function multiPerson(lens: Lens): boolean;           // ≥ 2 persons
export function personNumber(lens: Lens, id: PersonId): number;   // display order + 1 (S §2.1)
export function selKey(lens: Lens): string;                 // 'all' | person id
export interface PersonNote { text: string; dim: boolean }
export function personNote(tab: TabId, lens: Lens): PersonNote | null;
export function bodyNoteFor(body: BodyContext | undefined, lens: Lens, sel: PanelSelection): BodyNote | null;
export function photoScoped(sel: PanelSelection): boolean;  // A11: 濾鏡, or the active item is 美白 / 銳化 / 增高 / 長腿
export function sliderEmptyText(lens: Lens, sel: PanelSelection): string | null;
export function photoTouchToast(b: SliderBinding, lens: Lens, seen: Set<string>): string | null;
// PanelItem gains   badge?: string
// SliderBinding gains   aria?: string   (aria-label; absent → label)
// BodyContext gains   legsAnchor?: PersonId | null
```
- `SliderRow` gains the prop `emptyText?: string | null`.

- [ ] **Step 1: Failing tests (`src/ui/panelModel.test.ts`)**

Intended change #3 (S §8.5): in the import list replace `BODY_MULTI_NOTE,` (`:20`) with `BANDS_NOTE,`; `:264` becomes `expect(bodyNote(ready({ people: 2 }))).toBeNull();`; the test at `:333-335` becomes:

```ts
  it('the bands note replaces the multi-person hint (P6, S §2.6)', () => {
    expect(BANDS_NOTE).toBe('增高、長腿會拉伸整排畫面，套用於整張照片');
  });
```

Append (imports: `assignPersons, withPersons` from `../edit/state`; `lensFor, NO_BODY_NOTE, NO_FACE_NOTE, P0_INFO, type PersonInfo` from `../edit/lens`; `personFromPreset` from `../edit/state`; `bodyNoteFor, legsAnchorNote, personNote, photoScoped, photoTouchToast, sliderEmptyText` from `./panelModel`; `Selection` type):

```ts
describe('persons in the panel (S §2.4, A9, A11)', () => {
  // person 1: face + body · person 2: face only · person 3: body only
  const persons: PersonInfo[] = [
    { id: 'f0', face: true, body: true },
    { id: 'f1', face: true, body: false },
    { id: 'b1', face: false, body: true },
  ];
  const base = assignPersons(editFromLegacy(defaultParams()), ['f0', 'f1', 'b1'], 'f0');
  const at = (sel: Selection, e: EditState = base) => lensFor(e, sel, persons, 'f0');
  const one = (id: 'f0' | 'f1' | 'b1') => at({ kind: 'person', id });
  const ALL: Selection = { kind: 'all' };

  it('a body-only person: 磨皮 / 紅潤 disabled per item with the no-face reason; 美白 / 銳化 usable, badged 整張', () => {
    const items = itemsFor(one('b1'), sel({ tab: 'skin' }));
    expect(byKey(items, 'skin.smooth')).toMatchObject({ disabled: true, reason: NO_FACE_NOTE });
    expect(byKey(items, 'skin.rosy')).toMatchObject({ disabled: true, reason: NO_FACE_NOTE });
    expect(byKey(items, 'skin.whiten')).toMatchObject({ disabled: false, badge: '整張' });
    expect(byKey(items, 'skin.sharpen')).toMatchObject({ disabled: false, badge: '整張' });
    expect(personNote('skin', one('b1'))).toEqual({ text: NO_FACE_NOTE, dim: false });
    expect(personNote('preset', one('b1'))).toEqual({ text: NO_FACE_NOTE, dim: false });
    expect(personNote('shape', one('b1'))).toEqual({ text: NO_FACE_NOTE, dim: true });
    expect(personNote('makeup', one('b1'))).toEqual({ text: NO_FACE_NOTE, dim: true });
    expect(personNote('shape', at(ALL))).toBeNull();
    expect(personNote('shape', one('f1'))).toBeNull();
  });
  it('one person: no badges, no person notes, v0.3 labels and keys', () => {
    const l = lensFor(editFromLegacy(defaultParams()), { kind: 'person', id: 'p0' }, P0_INFO, 'p0');
    expect(byKey(itemsFor(l, sel({ tab: 'skin' })), 'skin.whiten').badge).toBeUndefined();
    expect(personNote('shape', l)).toBeNull();
    const b = sliderFor(l, sel({ tab: 'skin', skin: 'skin.whiten' }))!;
    expect(b).toMatchObject({ key: 'skin.whiten', label: '美白' });
    expect(b.aria).toBeUndefined();
  });
  it('美體 note order: status, then the selected person without a body, then the bands / 長腿 anchor note', () => {
    const ctx = { ...ready({ people: 2 }), legsAnchor: 'b1' };
    expect(bodyNoteFor({ ...ctx, status: 'loading' }, one('f1'), bodySel('body.waist'))?.text).toBe('正在偵測人物…');
    expect(bodyNoteFor(ctx, one('f1'), bodySel('body.waist'))?.text).toBe(NO_BODY_NOTE);
    expect(bodyNoteFor(ctx, at(ALL), bodySel('body.waist'))).toBeNull();
    expect(bodyNoteFor(ctx, one('f0'), bodySel('height'))?.text).toBe(BANDS_NOTE);
    expect(bodyNoteFor(ctx, at(ALL), bodySel('body.legs'))?.text).toBe(legsAnchorNote(3));
    expect(legsAnchorNote(3)).toBe('長腿以人物 3 的腿長為準，套用於整張照片');
    expect(bodyNoteFor(ctx, one('f0'), bodySel('body.waist'))).toBeNull();
  });
  it('body items under ≥ 2 persons are gated per person (the lens), 增高 / 長腿 / 背景保護 badged 整張', () => {
    const items = itemsFor(one('f1'), bodySel('body.waist'), ready({ people: 2 }));
    expect(byKey(items, 'body.waist')).toMatchObject({ disabled: true, reason: NO_BODY_NOTE });
    expect(byKey(items, 'height').badge).toBe('整張');
    expect(byKey(items, 'body.legs').badge).toBe('整張');
    expect(byKey(items, 'protect').badge).toBe('整張');
    expect(byKey(itemsFor(at(ALL), bodySel('body.waist'), ready({ people: 2 })), 'body.waist').disabled).toBe(false);
  });
  it('slider identity and labels (S §2.4): key per selection, 人物 n / 全部 / 整張照片, mixed by display value', () => {
    const b = sliderFor(one('f1'), sel({ tab: 'shape', shape: 'shape.eyeEnlarge' }))!;
    expect(b).toMatchObject({ key: 'f1:shape.eyeEnlarge', label: '大眼', aria: '大眼，人物 2' });
    expect(sliderFor(at(ALL), sel({ tab: 'shape', shape: 'shape.eyeEnlarge' }))!.aria).toBe('大眼，全部');
    const w = sliderFor(one('f1'), sel({ tab: 'skin', skin: 'skin.whiten' }))!;
    expect(w).toMatchObject({ label: '美白 · 整張照片', aria: '美白，整張照片' });
    const near = withPersons(withPersons(base, ['f0'], (p) => ({ ...p, values: { ...p.values, 'shape.eyeEnlarge': 0.3451 } })), ['f1'], (p) => ({ ...p, values: { ...p.values, 'shape.eyeEnlarge': 0.3549 } }));
    expect(sliderFor(at(ALL, near), sel({ tab: 'shape', shape: 'shape.eyeEnlarge' }))!.mixed).toBe(false);
    const far = withPersons(near, ['f1'], (p) => ({ ...p, values: { ...p.values, 'shape.eyeEnlarge': 0.4 } }));
    expect(sliderFor(at(ALL, far), sel({ tab: 'shape', shape: 'shape.eyeEnlarge' }))!.mixed).toBe(true);
  });
  it('程度 under 全部 with different presets: no slider, the row says 各人不同', () => {
    // base: f0 holds p0 (自然), f1 and b1 the template (原圖): the face persons already differ
    const same = withPersons(base, ['f1', 'b1'], () => personFromPreset('natural', 1));
    const mixed = withPersons(same, ['f1'], () => personFromPreset('refined', 1));
    expect(sliderFor(at(ALL, mixed), sel({ tab: 'preset' }))).toBeNull();
    expect(sliderEmptyText(at(ALL, mixed), sel({ tab: 'preset' }))).toBe('各人不同');
    expect(sliderEmptyText(at(ALL, same), sel({ tab: 'preset' }))).toBeNull();
    expect(sliderFor(at(ALL, same), sel({ tab: 'preset' }))).toMatchObject({ label: '程度', value: 1 });
  });
  it('no dead slider: an item the selected person cannot use has no slider; photo items keep theirs (Review Focus #2)', () => {
    expect(sliderFor(one('b1'), sel({ tab: 'skin', skin: 'skin.smooth' }))).toBeNull(); // 美膚 opens on 磨皮
    expect(sliderFor(one('b1'), sel({ tab: 'shape', shape: 'shape.eyeEnlarge' }))).toBeNull();
    expect(sliderFor(one('b1'), sel({ tab: 'makeup', makeupPart: 'lip' }))).toBeNull();
    expect(sliderFor(one('f1'), bodySel('body.waist'), ready({ people: 2 }))).toBeNull();
    expect(sliderFor(one('b1'), sel({ tab: 'skin', skin: 'skin.whiten' }))).not.toBeNull();
    expect(sliderFor(one('f1'), bodySel('height'), ready({ people: 2 }))).not.toBeNull();
    expect(sliderFor(at(ALL), sel({ tab: 'skin', skin: 'skin.smooth' }))).not.toBeNull();
  });
  it('a photo without a face (two body persons): 磨皮 / 紅潤 act on all skin and read 「整張照片」 (S §2.4 美膚)', () => {
    const bodies: PersonInfo[] = [
      { id: 'b0', face: false, body: true },
      { id: 'b1', face: false, body: true },
    ];
    const e = assignPersons(editFromLegacy(defaultParams()), ['b0', 'b1'], 'b0');
    const l = lensFor(e, { kind: 'person', id: 'b1' }, bodies, 'b0');
    expect(sliderFor(l, sel({ tab: 'skin', skin: 'skin.smooth' }))).toMatchObject({ label: '磨皮 · 整張照片', aria: '磨皮，整張照片' });
    expect(byKey(itemsFor(l, sel({ tab: 'skin' })), 'skin.rosy')).toMatchObject({ disabled: false, badge: '整張' });
  });
  it('A11: the chips dim on 濾鏡 and while 美白 / 銳化 / 增高 / 長腿 is the active item', () => {
    expect(photoScoped(sel({ tab: 'filter' }))).toBe(true);
    expect(photoScoped(sel({ tab: 'skin', skin: 'skin.whiten' }))).toBe(true);
    expect(photoScoped(sel({ tab: 'skin', skin: 'skin.smooth' }))).toBe(false);
    expect(photoScoped(bodySel('height'))).toBe(true);
    expect(photoScoped(bodySel('body.legs'))).toBe(true);
    expect(photoScoped(bodySel('body.waist'))).toBe(false);
  });
  it('the first touch of each photo-level item says so once; person items and one person never', () => {
    const seen = new Set<string>();
    const w = sliderFor(one('f1'), sel({ tab: 'skin', skin: 'skin.whiten' }))!;
    expect(photoTouchToast(w, one('f1'), seen)).toBe('美白套用於整張照片');
    expect(photoTouchToast(w, one('f1'), seen)).toBeNull();
    expect(photoTouchToast(sliderFor(one('f1'), sel({ tab: 'skin', skin: 'skin.smooth' }))!, one('f1'), seen)).toBeNull();
    const h = sliderFor(one('f0'), bodySel('height'), ready({ people: 2 }))!;
    expect(photoTouchToast(h, one('f0'), seen)).toBe('增高套用於整張照片');
  });
});
```

(`sel`, `bodySel`, `ready`, `byKey` and `defaultParams` are the file's existing helpers / imports.)

Run: `npx vitest run src/ui/panelModel.test.ts`
Expected: FAIL (missing exports; `bodyNote(ready({ people: 2 }))` is still the old hint).

- [ ] **Step 2: Implement in `src/ui/panelModel.ts` (CRLF)**

1. Imports: add `import { NO_BODY_NOTE, NO_FACE_NOTE } from '../edit/lens';` and `PersonId` to the type import.
2. `BodyContext` (`:62-91`): after `suggestedBand?` add `/** the person 長腿 is measured on (Editor: legsAnchor, else the primary with a body) */ legsAnchor?: PersonId | null;`. The `people` doc comment becomes `/** body persons in the photo */`.
3. Delete `BODY_MULTI_NOTE` (`:93-94`); in `bodyNote`, `case 'ready': return null;`.
4. After `bodyNote` add:

```ts
export const PHOTO_BADGE = '整張';
export const PHOTO_SCOPE = '整張照片';
export const MIXED = '各人不同';
export const BANDS_NOTE = '增高、長腿會拉伸整排畫面，套用於整張照片';
export const legsAnchorNote = (n: number): string => `長腿以人物 ${n} 的腿長為準，套用於整張照片`;

/** ≥ 2 persons: the person / photo distinction shows (labels, badges, notes, strip) */
export const multiPerson = (lens: Lens): boolean => lens.persons.length >= 2;
/** a person's number: position in the cache's display order + 1, never derived from the id (S §2.1) */
export const personNumber = (lens: Lens, id: PersonId): number => lens.persons.findIndex((p) => p.id === id) + 1;
/** slider identity: a person switch must reset the drag state and the double-tap timer (S §2.4) */
export const selKey = (lens: Lens): string => (lens.sel.kind === 'all' ? 'all' : lens.sel.id);

export interface PersonNote {
  text: string;
  /** the whole strip is off (美型, 美妝); else an info line above usable items (一鍵, 美膚) */
  dim: boolean;
}

/** S §2.4: a body-only person on a face tab. 美體 has bodyNoteFor; 濾鏡 is photo-level; 全部 has no person note. */
export function personNote(tab: TabId, lens: Lens): PersonNote | null {
  if (!multiPerson(lens) || lens.sel.kind !== 'person' || tab === 'body' || tab === 'filter') return null;
  const id = lens.sel.id;
  const me = lens.persons.find((p) => p.id === id);
  if (!me || me.face) return null;
  return { text: NO_FACE_NOTE, dim: tab === 'shape' || tab === 'makeup' };
}

/** S §2.4 美體 note, the first that applies: detection status · the selected person has no body · bands / 長腿 anchor */
export function bodyNoteFor(body: BodyContext | undefined, lens: Lens, sel: PanelSelection): BodyNote | null {
  const status = bodyNote(body);
  if (status || !multiPerson(lens)) return status;
  if (lens.sel.kind === 'person') {
    const id = lens.sel.id;
    const me = lens.persons.find((p) => p.id === id);
    if (me && !me.body) return { text: NO_BODY_NOTE, tone: 'info' };
  }
  if (sel.body === 'height' || sel.body === 'body.legs') {
    const anchor = body?.legsAnchor ?? null;
    const bodies = lens.persons.filter((p) => p.body).length;
    if (sel.body === 'body.legs' && anchor && bodies >= 2) return { text: legsAnchorNote(personNumber(lens, anchor)), tone: 'info' };
    return { text: BANDS_NOTE, tone: 'info' };
  }
  return null;
}

/** A11: the chips and boxes dim while the tab or its active item is photo-level */
export function photoScoped(sel: PanelSelection): boolean {
  if (sel.tab === 'filter') return true;
  if (sel.tab === 'skin') return sel.skin === 'skin.whiten' || sel.skin === 'skin.sharpen';
  if (sel.tab === 'body') return sel.body === 'height' || sel.body === 'body.legs';
  return false;
}

const isPhotoItem = (id: ParamId): boolean => paramDef(id).scope === 'photo';
/** photo-level as the user sees it: the photo scope, plus 磨皮 / 紅潤 in a photo without a face (all skin, RM §3.3) */
const photoLike = (lens: Lens, id: ParamId): boolean => isPhotoItem(id) || (lens.noFace && (id === 'skin.smooth' || id === 'skin.rosy'));
const badged = (lens: Lens, item: PanelItem): PanelItem => (multiPerson(lens) ? { ...item, badge: PHOTO_BADGE } : item);
/** ≥ 2 persons: a person item the selected person (or no 全部 target) can use; else no slider, never one that snaps back */
const usable = (lens: Lens, id: ParamId): boolean => !multiPerson(lens) || lens.applies(id).ok;
```

5. `PanelItem` (`:207-223`): after `pressed?` add `/** short tile badge: 「整張」 on photo-level items with ≥ 2 persons (A9; step 5 adds 「左右」) */ badge?: string;`.
6. `SliderBinding`: after `label` add `/** aria-label (S §2.4): 「{label}，人物 {n}」 / 「{label}，全部」 / 「{label}，整張照片」; absent → label */ aria?: string;`.
7. In `bodyItems` (Task 10 version):
   - `height` → `badged(lens, height)` and `protect` → `badged(lens, protect)` before gating;
   - the slider map: the gate becomes

```ts
        // ≥ 2 persons with a finished detection: the lens decides per person (its `available` reads each person's
        // measure, S §2.4 "Availability under 全部"); 長腿 is photo-level and keeps the anchor's availability
        multiPerson(lens) && body?.status === 'ready' && d.id !== 'body.legs' ? lens.applies(d.id) : bodyGate(body, d.id),
```

     and the item is `isPhotoItem(d.id) ? badged(lens, item) : item`.
8. In `itemsFor`:
   - `case 'skin': case 'shape':` — for each `d`, build the item as today, then `const it = photoLike(lens, d.id) ? badged(lens, item) : item; return multiPerson(lens) && sel.tab === 'skin' ? gated(it, lens.applies(d.id)) : it;` (美型 keeps the whole-strip dimming of `personNote`, as v0.3 did for a photo without a face);
   - `case 'filter':` — map each filter item through `badged(lens, …)`.
9. `paramBinding` and `sliderFor`: wrap every binding `sliderFor` returns (except `null`) in

```ts
/** ≥ 2 persons: the key carries the selection, photo items read 「· 整張照片」, aria names the target (S §2.4, A9) */
function decorate(b: SliderBinding, lens: Lens, photo: boolean): SliderBinding {
  if (!multiPerson(lens)) return b;
  const who = photo ? PHOTO_SCOPE : lens.sel.kind === 'all' ? '全部' : `人物 ${personNumber(lens, lens.sel.id)}`;
  return { ...b, key: `${selKey(lens)}:${b.key}`, label: photo ? `${b.label} · ${PHOTO_SCOPE}` : b.label, aria: `${b.label}，${who}` };
}
```

   with `photo` = `true` for 增高, 濾鏡強度 and photo-level params (`photoLike(lens, b.param)`), else `false` (程度, 美妝 and every person item). Concretely, in `sliderFor`: `preset` → `decorate(binding, lens, false)`; `skin`/`shape` → `if (!usable(lens, id)) return null;` then `decorate(paramBinding(lens, id), lens, photoLike(lens, id))`; `body` → after the existing `bodyGate` check, `if (sel.body !== 'height' && !usable(lens, sel.body)) return null;` then `decorate(sel.body === 'height' ? heightBinding(edit, body) : paramBinding(lens, sel.body), lens, sel.body === 'height' || isPhotoItem(sel.body))`; `filter` → `decorate({...}, lens, true)`; `makeup` → `if (!usable(lens, makeupKey(sel.makeupPart))) return null;` then `decorate({...}, lens, false)` (with one person `usable` is always true, so v0.3's always-present makeup slider and every one-person binding are unchanged).
10. Append:

```ts
/** the slider row's text when there is no slider: 程度 under 全部 with different presets (S §2.4) */
export function sliderEmptyText(lens: Lens, sel: PanelSelection): string | null {
  return sel.tab === 'preset' && lens.sel.kind === 'all' && lens.preset().mixed ? MIXED : null;
}

/** 「{label}套用於整張照片」 on the first touch of each photo-level slider in this editor (≥ 2 persons, S §2.4) */
export function photoTouchToast(b: SliderBinding, lens: Lens, seen: Set<string>): string | null {
  if (!multiPerson(lens)) return null;
  const id = b.param ?? (b.key.endsWith('body.height') ? 'height' : b.key.includes('filter.') ? 'filter.amount' : null);
  if (id === null || (id !== 'height' && !photoLike(lens, id as ParamId)) || seen.has(id)) return null;
  seen.add(id);
  const label = id === 'height' ? '增高' : paramDef(id as ParamId).label;
  return `${label}套用於整張照片`;
}
```

- [ ] **Step 3: `BeautyPanel` (CRLF)**

1. Import `bodyNoteFor, personNote` from `../panelModel` (drop `bodyNote`).
2. Below `const items = itemsFor(lens, sel, body);`:

```tsx
  // photo-level face note (no face, 基本模式, tracker health) first; then the selected person's (S §2.4, U5)
  const pNote = personNote(sel.tab, lens);
  const offText = faceNote ?? (pNote?.dim ? pNote.text : null);
  const faceOff = !!offText && FACE_TABS.includes(sel.tab);
  const infoNote = !faceOff && pNote && !pNote.dim ? pNote.text : null;
  const note = sel.tab === 'body' ? bodyNoteFor(body, lens, sel) : null;
```

   (replacing the old `faceOff` / `note` lines); the face-off `<p>` renders `{offText}`; after it add `{infoNote && <p class="strip-note" role="note">{infoNote}</p>}`.
3. Inside `<span class="item-tile">`, after the switch `<i>`: `{item.badge && <span class="item-badge" aria-hidden="true">{item.badge}</span>}`; the button gets `aria-description={item.disabled ? (item.reason ?? undefined) : item.badge ? '整張照片' : undefined}`.
4. Tabs: `const unavailable = t.id === 'body' ? bodyOff : (!!faceNote || personNote(t.id, lens)?.dim === true) && FACE_TABS.includes(t.id);` and `const why = t.id === 'body' ? bodyNoteFor(body, lens, sel)?.text : (faceNote ?? personNote(t.id, lens)?.text);`.

- [ ] **Step 4: `SliderRow` (CRLF)**

1. Props: add `/** shown in the empty row (程度 under 全部 with different presets) */ emptyText?: string | null;`.
2. Empty row: `if (!binding) return emptyText ? <div class={`slider-row empty${float ? ' float' : ''}`}><span class="slider-empty">{emptyText}</span></div> : <div class={`slider-row empty${float ? ' float' : ''}`} aria-hidden="true" />;`
3. `aria-label={binding.aria ?? binding.label}`; `aria-valuetext={binding.mixed ? `${text}，各人不同` : text}`; the label span: `<span class="slider-label">{binding.label}{binding.mixed && <small class="slider-mixed">各人不同</small>}</span>`.

- [ ] **Step 5: Styles (`src/ui/theme.css`, CRLF) and the P6 comment**

Append:

```css
/* v0.4 persons (S §2.1, §2.4) */
.item-badge {
  position: absolute;
  right: 2px;
  bottom: 2px;
  padding: 0 3px;
  border-radius: 4px;
  font-size: 9px;
  line-height: 13px;
  background: var(--elevated);
  color: var(--text-2);
}
.item-tile {
  position: relative;
}
.slider-mixed {
  margin-left: 6px;
  font-size: 11px;
  color: var(--text-2);
}
.slider-row.empty .slider-empty {
  margin: auto;
  font-size: 13px;
  color: var(--text-2);
}
```

(`--elevated` / `--text-2` are existing tokens of `theme.css`; `.item-tile` (`:337`) is not `position: relative` yet and clips with `overflow: hidden`, hence the badge sits 2 px inside its corner.) Then normalize the file's line endings back to CRLF (an editor may have written LF for the new lines):

```bash
node -e "const f='src/ui/theme.css';const fs=require('fs');fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace(/\r?\n/g,'\r\n'))"
```

Run the same command for `src/ui/panelModel.ts`, `src/ui/components/BeautyPanel.tsx` and `src/ui/components/Slider.tsx`, then check `git diff --stat` shows only the edited lines.

`src/body/measure.ts:153-156`: the `people` comment becomes `/** people detected in the photo (the v1 BodyDetection field; persons and their pairing live in DetectionCache) */`.

- [ ] **Step 6: Run and commit**

Run: `npx vitest run src/ui && npm run typecheck`
Expected: PASS.

Run: `npm run build && npx playwright test tests/e2e/editor.spec.ts tests/e2e/camera.spec.ts tests/e2e/body.spec.ts`
Expected: PASS (one person: labels, keys and notes as v0.3; `camera.spec.ts:43` still reads aria-label 「美白」).

```bash
git add src/ui/panelModel.ts src/ui/panelModel.test.ts src/ui/components/BeautyPanel.tsx src/ui/components/Slider.tsx src/ui/theme.css src/body/measure.ts
git commit -m "v0.4 step 1d: panel per person (notes, per-item gating, 整張 badges, slider identity and labels)"
```

---

### Task 23: Person strip, face boxes, photo taps, selection and the editor toasts (sub-step 1d gate)

**Files:**
- Create: `src/ui/components/PersonStrip.tsx`, `src/ui/components/FaceBoxes.tsx`
- Modify: `src/ui/screens/zoomPan.ts` (CRLF, `:33-126`), `src/ui/screens/Editor.tsx`, `src/ui/editorModel.ts` (append), `src/ui/editorModel.test.ts` (append), `src/body/field.ts` (export `fieldBands`), `src/store/settings.ts` (append), `src/store/settings.test.ts` (append), `src/types.ts:409-421` (DebugState `lambdaGlobal?`, CRLF), `src/ui/theme.css` (CRLF, append), `tests/e2e/fixtures.ts` (append), `tests/e2e/persons.spec.ts` (append), `tests/e2e/body.spec.ts` (append), `src/bench/multiFace.ts` (rows PE, M)

**Interfaces:**
- Consumes: `hitPerson`, `HitCtx` (Task 15), `bodyBox` (Task 15), Task 21's editor state, Task 22's panel helpers, `forwardY` (`bands.ts:50`).
- Produces:

```ts
// src/ui/screens/zoomPan.ts
export interface ZoomPanOptions {
  /** one pointer, ≤ 8 px, not on a button / .slider-row / .status: UV of the transformed layer and its rect (S §2.3) */
  onTap?(uv: [number, number], layer: DOMRect): void;
}
export function useZoomPan(stageRef, layerRef, enabled: boolean, opts?: ZoomPanOptions): void;  // apply() also writes --zs
// src/body/field.ts
export function fieldBands(input: BodyFieldInput): Band[];     // the bands buildBodyField uses (增高, 長腿)
// src/store/settings.ts
export const PERSONS_HINT_KEY = 'meiyan.hint.persons.v1';
export function takePersonsHint(): boolean;                    // true once ever, then false
// src/ui/editorModel.ts
export function changedPersons(a: EditState, b: EditState): PersonId[];
export function undoToast(kind: 'undo' | 'redo', changed: readonly PersonId[], sel: Selection, numberOf: (id: PersonId) => number): string | null;
export function answerNotices(cache: DetectionCache, persons: number, firstGroupEver: boolean): string[];
export function thumbRect(cache: DetectionCache, person: PersonInfoCached): Rect;     // UV, square in pixels
export function hitCtxOf(cache: DetectionCache, bodies: boolean, field: BodyField | null, layer: { width: number; height: number }): HitCtx;
export const PERSON_TABS: ReadonlySet<TabId>;                  // 一鍵 · 美膚 · 美型 · 美體 · 美妝
// src/ui/components/PersonStrip.tsx
export interface StripPerson { id: PersonId; n: number; label: string; thumb: string | null; changed: boolean; ruler: boolean }
export function PersonStrip(p: { persons: StripPerson[]; selection: Selection; photoScope: boolean; onSelect(s: Selection): void }): JSX.Element;
export function drawThumb(bitmap: ImageBitmap, r: Rect): string | null;                // 132² JPEG data URL
// src/ui/components/FaceBoxes.tsx
export interface FaceBoxItem { person: PersonId; n: number; box: Rect; selected: boolean; changed: boolean; dashed: boolean; narrow: boolean }
export function FaceBoxes(p: { items: FaceBoxItem[]; dim: boolean; idle: boolean; mapY?: (y: number) => number }): JSX.Element | null;
// DebugState gains   lambdaGlobal?: number
```

- [ ] **Step 1: Failing unit tests**

Append to `src/ui/editorModel.test.ts` (imports: `answerNotices, changedPersons, hitCtxOf, thumbRect, undoToast` from `./editorModel`; `withPersons` from `../edit/state`):

```ts
describe('editor persons UI helpers (S §1.1 item 8, §2.6)', () => {
  const base = assignPersons(editFromLegacy(applyPreset('natural', 1)), ['f0', 'f1', 'b1'], 'f0');
  const bump = (e: EditState, id: string) => withPersons(e, [id], (p) => ({ ...p, values: { ...p.values, 'shape.eyeEnlarge': 0.9 } }));
  it('changedPersons compares each person by key', () => {
    expect(changedPersons(base, bump(base, 'f1'))).toEqual(['f1']);
    expect(changedPersons(base, bump(bump(base, 'f1'), 'f0')).sort()).toEqual(['f0', 'f1']);
    expect(changedPersons(base, base)).toEqual([]);
  });
  it('undo / redo toast only when the step touched persons other than the selected one', () => {
    const n = (id: string) => ({ f0: 1, f1: 2, b1: 3 })[id] ?? 0;
    expect(undoToast('undo', ['f1'], { kind: 'person', id: 'f0' }, n)).toBe('已復原人物 2 的變更');
    expect(undoToast('redo', ['f1', 'b1'], { kind: 'person', id: 'f0' }, n)).toBe('已重做人物 2、3 的變更');
    expect(undoToast('undo', ['f0', 'f1'], { kind: 'person', id: 'f0' }, n)).toBeNull();
    expect(undoToast('undo', ['f1'], { kind: 'all' }, n)).toBeNull();
    expect(undoToast('undo', [], { kind: 'person', id: 'f0' }, n)).toBeNull();
  });
  it('answer notices: over cap wins over too small, both only with the strip; the first group photo ever adds the hint', () => {
    const c = makeCache({ dropped: { tooSmall: 1, overCap: 2 } });
    expect(answerNotices(c, 3, true)).toEqual(['偵測到超過 6 張臉，只會美化最大的 6 張', '點選臉部或下方人物，可個別調整']);
    expect(answerNotices({ ...c, dropped: { tooSmall: 1, overCap: 0 } }, 3, false)).toEqual(['有些臉太小，不會套用臉部效果']);
    expect(answerNotices(c, 1, true)).toEqual([]);
  });
  it('thumbRect: the face box padded 30 %, square in pixels; a body-only person uses its head points', () => {
    const c = makeCache({ bodies: [cacheBody('b0', 0.8)], persons: [{ id: 'f0', face: 'f0', body: null }, { id: 'f1', face: 'f1', body: null }, { id: 'b0', face: null, body: 'b0' }] });
    const r = thumbRect(c, c.persons[0]);
    expect(r.w * c.width).toBeCloseTo(r.h * c.height, 6);
    expect(r.x + r.w / 2).toBeCloseTo(0.3, 6);
    const b = thumbRect(c, c.persons[2]);
    expect(b.x + b.w / 2).toBeCloseTo(0.8, 1);
    expect(b.y).toBeLessThan(0.4);
  });
  it('hitCtxOf: faces with their persons; bodies only on 美體; 44 pt in UV of the layer', () => {
    const c = makeCache();
    const ctx = hitCtxOf(c, false, null, { width: 440, height: 330 });
    expect(ctx.faces.map((f) => f.person)).toEqual(['f0', 'f1']);
    expect(ctx.bodies).toBeUndefined();
    expect([ctx.minW, ctx.minH]).toEqual([0.1, 44 / 330]);
  });
});
```

(`makeCache`, `cacheBody`, `assignPersons`, `editFromLegacy`, `applyPreset` are imported since Task 21; add `EditState` to the type import.)

Append to `src/store/settings.test.ts` (import `PERSONS_HINT_KEY, takePersonsHint`):

```ts
describe('first group photo hint (S §1.1 item 11)', () => {
  it('is true exactly once per install and survives a failing storage as false', () => {
    expect(takePersonsHint()).toBe(true);
    expect(store.getItem(PERSONS_HINT_KEY)).not.toBeNull();
    expect(takePersonsHint()).toBe(false);
  });
});
```

Run: `npx vitest run src/ui/editorModel.test.ts src/store/settings.test.ts`
Expected: FAIL (missing exports).

- [ ] **Step 2: Pure helpers**

`src/store/settings.ts`, append:

```ts
// ───────────── one-time hints ─────────────

export const PERSONS_HINT_KEY = 'meiyan.hint.persons.v1';

/** The first group photo ever shows 「點選臉部或下方人物，可個別調整」 once (S §1.1 item 11): true once, then false. */
export function takePersonsHint(): boolean {
  if (readJson(PERSONS_HINT_KEY) !== undefined) return false;
  writeJson(PERSONS_HINT_KEY, 1);
  // storage that silently drops writes (private mode) would repeat the hint on every photo: show it only if it stuck
  return readJson(PERSONS_HINT_KEY) !== undefined;
}
```

`src/ui/editorModel.ts`, append (imports: `stableKey` from `../store/undo`; `MAX_EDIT_FACES` from `../config/limits`; `bodyBox` from `../detect/cache`; `type HitCtx` from `../detect/persons`; `type TabId` from `./panelModel`; types `BodyField, PersonInfoCached, Selection`):

```ts
/** the persons whose params differ between two states (↶ ↷ highlight, S §1.1 item 8) */
export function changedPersons(a: EditState, b: EditState): PersonId[] {
  const ids = new Set([...Object.keys(a.persons), ...Object.keys(b.persons)]);
  return [...ids].filter((id) => stableKey(a.persons[id] ?? null) !== stableKey(b.persons[id] ?? null));
}

/** 「已復原人物 {n} 的變更」 when the step touched only persons other than the selected one (several: 「人物 2、3」) */
export function undoToast(kind: 'undo' | 'redo', changed: readonly PersonId[], sel: Selection, numberOf: (id: PersonId) => number): string | null {
  if (sel.kind !== 'person' || !changed.length || changed.includes(sel.id)) return null;
  const nums = changed.map(numberOf).filter((n) => n > 0).sort((x, y) => x - y);
  if (!nums.length) return null;
  return `${kind === 'undo' ? '已復原' : '已重做'}人物 ${nums.join('、')} 的變更`;
}

/** toasts after the first answer, in order (one slot, state.ts:146-151: the editor shows them one after another) */
export function answerNotices(cache: DetectionCache, persons: number, firstGroupEver: boolean): string[] {
  if (persons < 2) return [];
  const out: string[] = [];
  if (cache.dropped.overCap > 0) out.push(`偵測到超過 ${MAX_EDIT_FACES} 張臉，只會美化最大的 ${MAX_EDIT_FACES} 張`);
  else if (cache.dropped.tooSmall > 0) out.push('有些臉太小，不會套用臉部效果');
  if (firstGroupEver) out.push('點選臉部或下方人物，可個別調整');
  return out;
}

const squareAround = (cx: number, cy: number, sidePx: number, W: number, H: number): Rect => {
  const w = sidePx / W;
  const h = sidePx / H;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
};

/** the strip thumbnail's source rect (S §2.1): face box + 30 %; body-only: head points 0–10 + 60 %, else the top 30 % */
export function thumbRect(cache: DetectionCache, person: PersonInfoCached): Rect {
  const W = cache.width;
  const H = cache.height;
  const face = person.face ? cache.faces.find((f) => f.id === person.face) : undefined;
  if (face) {
    const b = face.box;
    return squareAround(b.x + b.w / 2, b.y + b.h / 2, Math.max(b.w * W, b.h * H) * 1.3, W, H);
  }
  const body = person.body ? cache.bodies?.find((x) => x.id === person.body) : undefined;
  if (!body) return { x: 0, y: 0, w: 1, h: 1 };
  const P = body.pose.points;
  const head: [number, number][] = [];
  for (let i = 0; i <= 10; i++) if (P[i * 4 + 3] >= 0.5) head.push([P[i * 4], P[i * 4 + 1]]);
  if (head.length >= 3) {
    const xs = head.map((p) => p[0]);
    const ys = head.map((p) => p[1]);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    return squareAround((x0 + x1) / 2, (y0 + y1) / 2, Math.max((x1 - x0) * W, (y1 - y0) * H) * 1.6, W, H);
  }
  const bb = bodyBox(body);
  const top = { x: bb.x, y: bb.y, w: bb.w, h: bb.h * 0.3 };
  return squareAround(top.x + top.w / 2, top.y + top.h / 2, Math.max(top.w * W, top.h * H), W, H);
}

/** the tabs whose items are person-level (boxes, taps, strip selection apply) */
export const PERSON_TABS: ReadonlySet<TabId> = new Set<TabId>(['preset', 'skin', 'shape', 'body', 'makeup']);

/** hitPerson's context (S §2.3): face boxes per person, bodies on 美體, the body field, 44 pt in UV of the layer rect */
export function hitCtxOf(cache: DetectionCache, bodies: boolean, field: BodyField | null, layer: { width: number; height: number }): HitCtx {
  const faces = cache.persons.flatMap((p) => {
    const f = p.face ? cache.faces.find((x) => x.id === p.face) : undefined;
    return f ? [{ person: p.id, box: f.box }] : [];
  });
  const bodyList = bodies
    ? cache.persons.flatMap((p) => {
        const b = p.body ? cache.bodies?.find((x) => x.id === p.body) : undefined;
        return b ? [{ person: p.id, mask: b.mask, box: bodyBox(b) }] : [];
      })
    : undefined;
  return { faces, ...(bodyList ? { bodies: bodyList } : {}), field, minW: 44 / Math.max(1, layer.width), minH: 44 / Math.max(1, layer.height) };
}
```

`src/body/field.ts`: extract the band list of `buildBodyField` (Task 20) into

```ts
/** the row bands of a field input (增高, then 長腿 measured on its anchor): the face boxes follow them (S §2.1) */
export function fieldBands(input: BodyFieldInput): Band[] {
  const bands: Band[] = [];
  const hb = input.heightBand ? heightBand(input.heightBand.top, input.heightBand.bottom, input.heightBand.amount) : null;
  if (hb) bands.push(hb);
  const lm = input.legs.measure;
  if (lm?.legs && input.legs.value > EPS) {
    const L = lm.legs;
    const lb = legsBand(L.hipY, L.kneeY, L.feetY, input.legs.value * L.vis, bands, L.ankleY);
    if (lb) bands.push(lb);
  }
  return bands;
}
```

and in `buildBodyField` replace those lines with `const bands = fieldBands(input);` (same order, same values: the Task 20 snapshot still matches).

Run: `npx vitest run src/ui/editorModel.test.ts src/store/settings.test.ts src/body/field.test.ts`
Expected: PASS.

- [ ] **Step 3: Taps and `--zs` in `zoomPan.ts` (CRLF)**

Replace the signature and add the options ref:

```ts
export interface ZoomPanOptions {
  /**
   * One pointer, ≤ 8 px, not started on a button / .slider-row / .status (S §2.3). Fires on the pointer-up, before a
   * double tap's fit, with the UV of the transformed layer (right at any zoom) and that rect.
   */
  onTap?(uv: [number, number], layer: DOMRect): void;
}

export function useZoomPan(
  stageRef: { current: HTMLElement | null },
  layerRef: { current: HTMLElement | null },
  enabled: boolean,
  opts: ZoomPanOptions = {},
): void {
  const view = useRef<View>({ s: 1, x: 0, y: 0 });
  // read through a ref: the effect depends on [enabled] only and must not call a stale callback
  const optsRef = useRef(opts);
  optsRef.current = opts;
```

In `apply`, after the transform line: `layer.style.setProperty('--zs', String(s));`. In `up`, replace the `if (pts.size === 0 && !moved) { … }` block with:

```ts
      if (pts.size === 0 && !moved) {
        const onTap = optsRef.current.onTap;
        // a pointercancel (the browser took the gesture over) is no tap
        if (onTap && e.type === 'pointerup') {
          const r = layer.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) onTap([(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height], r);
        }
        const now = performance.now();
        if (now - lastTap < DOUBLE_TAP_MS) {
          lastTap = 0;
          apply({ s: 1, x: 0, y: 0 }, true);
        } else lastTap = now;
      }
```

Then run the CRLF normalizer of Task 22 Step 5 on `src/ui/screens/zoomPan.ts`.

- [ ] **Step 4: `PersonStrip` and `FaceBoxes`**

`src/ui/components/PersonStrip.tsx`:

```tsx
// The person strip (S §2.1): 「全部」 plus one 44 × 44 chip per person, a radiogroup between the stage and the slider
// row. Dimmed (and not selectable, still focusable) while the tab or its active item is photo-level (A11).
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { PersonId, Rect, Selection } from '../../types';
import { haptic } from '../platform';

export interface StripPerson {
  id: PersonId;
  /** display number (cache order + 1) */
  n: number;
  /** aria-label: 人物 {n} / 人物 {n}（未偵測到臉部） / 人物 {n}（未偵測到身體） */
  label: string;
  /** 132² data URL, or null while it is drawn */
  thumb: string | null;
  /** ↶ ↷ touched this person: 600 ms highlight */
  changed: boolean;
  /** 長腿 is measured on this person (S §2.4) */
  ruler: boolean;
}

const THUMB = 132;

/** the thumbnail of `r` (UV) of the working bitmap, 132² (44 pt at 3×), as a JPEG data URL; null without a 2D context */
export function drawThumb(bitmap: ImageBitmap, r: Rect): string | null {
  const c = document.createElement('canvas');
  c.width = THUMB;
  c.height = THUMB;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#222';
  ctx.fillRect(0, 0, THUMB, THUMB);
  ctx.drawImage(bitmap, r.x * bitmap.width, r.y * bitmap.height, r.w * bitmap.width, r.h * bitmap.height, 0, 0, THUMB, THUMB);
  const url = c.toDataURL('image/jpeg', 0.8);
  c.width = c.height = 0;
  return url;
}

export function PersonStrip({ persons, selection, photoScope, onSelect }: { persons: StripPerson[]; selection: Selection; photoScope: boolean; onSelect(s: Selection): void }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const selKey = selection.kind === 'all' ? 'all' : selection.id;
  useLayoutEffect(() => {
    rowRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [selKey]);
  const pick = (s: Selection) => {
    if (photoScope) return;
    if ((s.kind === 'all' ? 'all' : s.id) === selKey) return;
    haptic();
    onSelect(s);
  };
  return (
    <div class={`person-strip${photoScope ? ' dim' : ''}`} ref={rowRef} role="radiogroup" aria-label="選擇人物" aria-describedby={photoScope ? 'person-strip-scope' : undefined}>
      {photoScope && (
        <span class="strip-scope" id="person-strip-scope">
          整張照片
        </span>
      )}
      <button type="button" role="radio" class="person-chip all" aria-checked={selection.kind === 'all'} aria-disabled={photoScope ? 'true' : undefined} onClick={() => pick({ kind: 'all' })}>
        全部
      </button>
      {persons.map((p) => (
        <button
          key={p.id}
          type="button"
          role="radio"
          class={`person-chip${p.changed ? ' changed' : ''}`}
          aria-checked={selection.kind === 'person' && selection.id === p.id}
          aria-disabled={photoScope ? 'true' : undefined}
          aria-label={p.label}
          onClick={() => pick({ kind: 'person', id: p.id })}
        >
          {p.thumb ? <img src={p.thumb} alt="" /> : <span class="chip-blank" />}
          <span class="chip-num num" aria-hidden="true">
            {p.n}
          </span>
          {p.ruler && <i class="chip-ruler" aria-hidden="true" />}
        </button>
      ))}
    </div>
  );
}
```

`src/ui/components/FaceBoxes.tsx`:

```tsx
// Face boxes (S §2.1): drawn corner brackets inside .zoom-layer, never buttons (pointer-events: none). Every photo tap
// reaches zoomPan, which hit-tests (S §2.3). Strokes stay 2 px at any zoom through --zs (zoomPan apply).
import type { PersonId, Rect } from '../../types';

export interface FaceBoxItem {
  person: PersonId;
  n: number;
  /** source UV (the face box, or the pose box of a body-only person) */
  box: Rect;
  selected: boolean;
  changed: boolean;
  /** a body-only person in 美體: dashed brackets around its pose box */
  dashed: boolean;
  /** narrower than 24 pt on screen: no number badge */
  narrow: boolean;
}

const PAD = 0.15;

export function FaceBoxes({ items, dim, idle, mapY }: { items: FaceBoxItem[]; dim: boolean; idle: boolean; mapY?: (y: number) => number }) {
  if (!items.length) return null;
  return (
    <div class={`face-boxes${dim ? ' dim' : ''}${idle ? ' idle' : ''}`} aria-hidden="true">
      {items.map((it) => {
        const b = it.box;
        const x0 = b.x - b.w * PAD;
        const x1 = b.x + b.w * (1 + PAD);
        // rows stretched by 增高 / 長腿 move the box with them (forwardY of the current field's bands)
        const y0 = (mapY ?? ((y: number) => y))(b.y - b.h * PAD);
        const y1 = (mapY ?? ((y: number) => y))(b.y + b.h * (1 + PAD));
        return (
          <div
            key={it.person}
            class={`face-box${it.selected ? ' selected' : ''}${it.changed ? ' changed' : ''}${it.dashed ? ' dashed' : ''}`}
            style={{ left: `${x0 * 100}%`, top: `${y0 * 100}%`, width: `${(x1 - x0) * 100}%`, height: `${(y1 - y0) * 100}%` }}
          >
            <i class="br tl" />
            <i class="br tr" />
            <i class="br bl" />
            <i class="br br-r" />
            {!it.narrow && <span class="face-num num">{it.n}</span>}
          </div>
        );
      })}
    </div>
  );
}
```

`src/ui/theme.css` (CRLF), append, then normalize with the Task 22 command:

```css
.person-strip {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 52px;
  padding: 0 12px;
  overflow-x: auto;
  scrollbar-width: none;
  mask-image: linear-gradient(to right, #000 calc(100% - 16px), transparent);
}
.person-strip.dim .person-chip {
  /* (--dim is a colour token: dimming is an opacity, as for the other dimmed controls) */
  opacity: 0.4;
}
.strip-scope {
  flex: none;
  font-size: 12px;
  color: var(--text-2);
}
.person-chip {
  position: relative;
  flex: none;
  width: 44px;
  height: 44px;
  padding: 0;
  border-radius: 10px;
  overflow: hidden;
  border: 0;
  background: var(--elevated);
  color: var(--text);
  font-size: 13px;
}
.person-chip img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.person-chip[aria-checked='true'] {
  outline: 1px solid var(--accent);
  outline-offset: 1px;
}
.person-chip.changed,
.face-box.changed {
  box-shadow: 0 0 0 2px var(--accent);
}
.chip-num {
  position: absolute;
  right: 3px;
  bottom: 2px;
  font-size: 11px;
  text-shadow: 0 0 2px #000;
}
.chip-ruler {
  position: absolute;
  left: 3px;
  top: 3px;
  width: 10px;
  height: 3px;
  background: var(--accent);
}
.face-boxes {
  position: absolute;
  inset: 0;
  pointer-events: none;
  transition: opacity 200ms;
}
.face-boxes.idle .face-box:not(.changed) {
  opacity: 0.3;
}
.face-boxes.dim {
  opacity: 0.4;
}
.face-box {
  position: absolute;
  --c: rgb(255 255 255 / 0.6);
  /* the 1.5 s idle fade to 30 % (S §2.1 Fading): the opacity is the box's own, so the box carries the transition */
  transition: opacity 200ms;
}
.face-box.selected {
  --c: var(--accent);
}
.face-box .br {
  position: absolute;
  width: 22%;
  height: 22%;
  border: 0 solid var(--c);
  filter: drop-shadow(0 0 1px rgb(0 0 0 / 0.5));
}
.face-box .tl { left: 0; top: 0; border-left-width: calc(2px / var(--zs, 1)); border-top-width: calc(2px / var(--zs, 1)); }
.face-box .tr { right: 0; top: 0; border-right-width: calc(2px / var(--zs, 1)); border-top-width: calc(2px / var(--zs, 1)); }
.face-box .bl { left: 0; bottom: 0; border-left-width: calc(2px / var(--zs, 1)); border-bottom-width: calc(2px / var(--zs, 1)); }
.face-box .br-r { right: 0; bottom: 0; border-right-width: calc(2px / var(--zs, 1)); border-bottom-width: calc(2px / var(--zs, 1)); }
.face-box.dashed .br {
  border-style: dashed;
}
.face-num {
  position: absolute;
  left: 0;
  top: -20px;
  font-size: 13px;
  color: var(--c);
  transform: scale(calc(1 / var(--zs, 1)));
  transform-origin: top left;
}
```

- [ ] **Step 5: The editor (`src/ui/screens/Editor.tsx`)**

1. Imports: `FaceBoxes, type FaceBoxItem` (`../components/FaceBoxes`), `PersonStrip, drawThumb, type StripPerson` (`../components/PersonStrip`); `answerNotices, changedPersons, hitCtxOf, legsAnchorOf, PERSON_TABS, thumbRect, undoToast` (`../editorModel`); `personNumber, photoScoped, photoTouchToast, sliderEmptyText` (`../panelModel`); `hitPerson` (`../../detect/persons`); `bodyBox` (`../../detect/cache`); `fieldBands, bodyFieldCacheStats` (`../../body/field`); `forwardY` (`../../body/bands`); `takePersonsHint` (`../../store/settings`); `debug` (`../debug`, if not imported).
2. Selection (replacing Task 21's `const selection: Selection = …`):

```tsx
  const [selection, setSelection] = useState<Selection>({ kind: 'person', id: primary });
  /** a selected person that disappeared (p0 handed over, a rematch) falls back to the primary (S §2.2) */
  const selected: Selection = selection.kind === 'person' && !infos.some((p) => p.id === selection.id) ? { kind: 'person', id: primary } : selection;
  const multi = infos.length >= 2;
  const [dragging, setDragging] = useState(false);
  /** boxes at full opacity for 1.5 s after a tab change, a selection change or a photo tap */
  const [boxesIdle, setBoxesIdle] = useState(false);
  const idleTimer = useRef(0);
  const wakeBoxes = () => {
    setBoxesIdle(false);
    clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setBoxesIdle(true), 1500);
  };
  useEffect(wakeBoxes, [sel.tab, selected.kind === 'all' ? 'all' : selected.id]);
  useEffect(() => () => clearTimeout(idleTimer.current), []);
  const choose = (s: Selection) => {
    if (dragging) return; // a chip or photo tap during a slider drag is ignored (S §2.2)
    setSelection(s);
  };
```

   `lensOf` uses `selected` in place of `selection`. In `applyAnswer` (Task 21), after `rebaseOnDetect(…)`: `setSelection({ kind: 'person', id: a.detect.primary });`, and replace the toast line by:

```tsx
    if (!first) return;
    if (source.historyId && source.edit.primaryInit && a.detect.faces.length >= 2) thumbOwed.current = true;
    const notices = a.dropped || source.cacheDropped ? ['已重新偵測臉部，部分人物的設定已重設'] : [];
    const persons = a.detect.persons.length;
    notices.push(...answerNotices(a.detect, persons, persons >= 2 && takePersonsHint()));
    notices.forEach((text, i) => window.setTimeout(() => toast(text, 3200), i * 3400));
```

3. `update(e, commit)` (Task 12's): before `setEditState(e)` add the 全部 first-write toast:

```tsx
    if (multi && selected.kind === 'all' && !allToastDone.current && changedPersons(editRef.current, e).length) {
      allToastDone.current = true;
      toast('已套用到全部人物');
    }
```

   with `const allToastDone = useRef(false);` and `const touchedPhoto = useRef(new Set<string>());` declared with the other refs.
4. `slide(b, v, commit)`: first line `setDragging(!commit);`; then `const t = photoTouchToast(b, lensOf(editRef.current), touchedPhoto.current); if (t) toast(t);` before the existing contour / update lines.
5. Undo / redo (Task 12's `doUndo` / `doRedo`): capture `const before = editRef.current;` first; after `if (e) setEditState(e);` add `if (e) afterHistoryStep('undo', before, e);` (`'redo'` in `doRedo`), with:

```tsx
  const [changedIds, setChangedIds] = useState<readonly PersonId[]>([]);
  const changedTimer = useRef(0);
  const afterHistoryStep = (kind: 'undo' | 'redo', before: EditState, after: EditState) => {
    const ids = changedPersons(before, after);
    setChangedIds(ids);
    clearTimeout(changedTimer.current);
    changedTimer.current = window.setTimeout(() => setChangedIds([]), 600);
    if (!multi) return;
    const l = lensOf(after);
    const t = undoToast(kind, ids, selected, (id) => personNumber(l, id));
    if (t) toast(t, 2600);
  };
```

6. Photo taps (replacing `useZoomPan(stageRef, layerRef, !!session);`):

```tsx
  const tapsOn = !!session && multi && PERSON_TABS.has(sel.tab) && !showsHeightBand(sel, bodyCtx);
  useZoomPan(stageRef, layerRef, !!session, {
    onTap: tapsOn
      ? (uv, rect) => {
          wakeBoxes();
          const d = detectRef.current;
          if (!d || dragging) return;
          const hit = hitPerson(uv, hitCtxOf(d, sel.tab === 'body', fieldMemo.field, rect));
          if (hit) choose({ kind: 'person', id: hit });
        }
      : undefined,
  });
```

   (`bodyCtx` is computed earlier in the render: move this call below `const bodyCtx = …`.)
7. Body context per selection (replacing Task 21 item 6's `personBody` and the `bodyPanelContext` call):

```tsx
  // the 美體 measure shown: the selected person's body, else the primary's, else the first body person's (S §2.4)
  const bodyOwner =
    (selected.kind === 'person' && measures.has(selected.id) ? selected.id : null) ??
    (measures.has(primary) ? primary : null) ??
    ([...measures.keys()][0] ?? null);
  const ownerBody = bodyOwner ? (detect?.persons.find((p) => p.id === bodyOwner)?.body ?? null) : null;
  const bodyCtx = {
    ...bodyPanelContext(
      bodyDet.phase === 'done' ? { phase: 'done', det: detect && ownerBody ? bodyDetectionOf(detect, ownerBody) : null } : bodyDet,
      bodyTracker,
      bodyOwner ? (measures.get(bodyOwner) ?? null) : null,
      paramAvailability,
      retryBody,
    ),
    legsAnchor: detect ? legsAnchorOf(edit, detect, measures) : null,
  };
```

(`legsAnchorOf` is Task 21's helper in `editorModel.ts`: add `export` to it.)

8. Boxes, strip and thumbnails:

```tsx
  const [thumbs, setThumbs] = useState<Record<PersonId, string | null>>({});
  useEffect(() => {
    if (!detect || detect.persons.length < 2) return;
    const missing = detect.persons.filter((p) => !(p.id in thumbs));
    if (!missing.length) return;
    const next = { ...thumbs };
    for (const p of missing) {
      try {
        next[p.id] = drawThumb(source.bitmap, thumbRect(detect, p));
      } catch (e) {
        reportError(e, 'person thumb');
        next[p.id] = null;
      }
    }
    setThumbs(next);
  }, [detect]);

  const lens = lensOf(edit);
  const scope = multi && photoScoped(sel);
  const stripPersons: StripPerson[] = infos.map((p, i) => ({
    id: p.id,
    n: i + 1,
    label: `人物 ${i + 1}${!p.face ? '（未偵測到臉部）' : !p.body && detect?.bodies ? '（未偵測到身體）' : ''}`,
    thumb: thumbs[p.id] ?? null,
    changed: changedIds.includes(p.id),
    ruler: sel.tab === 'body' && sel.body === 'body.legs' && bodyCtx.legsAnchor === p.id,
  }));
  // 增高 / 長腿 stretch whole rows on every tab, so the boxes follow the bands wherever they show (S §2.1 Position)
  const bands = detect ? fieldBands(fieldInputOf(edit, detect, measures, bodyAspect)) : [];
  const layerW = layerRef.current?.getBoundingClientRect().width ?? 0;
  const boxItems: FaceBoxItem[] =
    detect && multi && PERSON_TABS.has(sel.tab)
      ? detect.persons.flatMap((p, i): FaceBoxItem[] => {
          const f = p.face ? detect.faces.find((x) => x.id === p.face) : undefined;
          const b = !f && sel.tab === 'body' && p.body ? detect.bodies?.find((x) => x.id === p.body) : undefined;
          const box = f?.box ?? (b ? bodyBox(b) : null);
          if (!box) return [];
          return [{ person: p.id, n: i + 1, box, selected: selected.kind === 'all' || selected.id === p.id, changed: changedIds.includes(p.id), dashed: !f, narrow: box.w * layerW < 24 }];
        })
      : [];
  const showBoxes = !!session && !fatal && !dragging && !hold.held && !showsHeightBand(sel, bodyCtx);
```

   In the JSX, inside `.zoom-layer` after `<CanvasHost …/>`: `{showBoxes && <FaceBoxes items={boxItems} dim={scope} idle={boxesIdle} mapY={bands.length ? (y) => forwardY(bands, y) : undefined} />}`. In `.editor-panel`, before `<SliderRow`: `{session && multi && <PersonStrip persons={stripPersons} selection={selected} photoScope={scope} onSelect={choose} />}`. `SliderRow` gets `emptyText={session && !faceOff ? sliderEmptyText(lens, sel) : null}` and `BeautyPanel` gets `lens={lens}`.
9. 重置: the label becomes `{confirmReset ? (multi ? '確定重置全部？' : '確定重置？') : '重置'}`.
10. Debug, in the render effect: `debug({ persons: infos.length, faces: session.faces.length, selected: selected.kind === 'all' ? 'all' : selected.id, boxes: (detectRef.current?.faces ?? []).map((f) => ({ id: f.id, ...f.box })) })`; in `applyField` after a change: `debug({ lambdaGlobal: bodyFieldCacheStats.lambdaGlobal })`.

`src/types.ts` (CRLF), `DebugState`: after `boxes` add `/** the last 美體 field's global fold-guard λ (1 = untouched; e2e) */ lambdaGlobal?: number;`.

- [ ] **Step 6: E2E helpers and the persons cases**

Append to `tests/e2e/fixtures.ts` (`readFileSync` from `node:fs`):

```ts
/** click a strip chip: n = 0 is 全部 */
export async function selectPerson(page: Page, n: number): Promise<void> {
  await page.getByRole('radio', { name: n === 0 ? '全部' : new RegExp(`^人物 ${n}`) }).click();
}

/** the screen point of a normalized source point on the editor's (unmirrored, zoom 1) layer */
export async function layerPoint(page: Page, u: number, v: number): Promise<{ x: number; y: number }> {
  const r = (await page.locator('.editor-stage .zoom-layer').boundingBox())!;
  return { x: r.x + u * r.width, y: r.y + v * r.height };
}

/** the centre of a debug face box (`__meiyan.boxes`) on screen */
export async function boxCentre(page: Page, id: string): Promise<{ x: number; y: number }> {
  const b = (await debugState(page)).boxes.find((x) => x.id === id)!;
  return layerPoint(page, b.x + b.w / 2, b.y + b.h / 2);
}

/** two-finger pinch about `c` from `d0` to `d1` px apart (CDP touch: Chromium turns it into pointer events) */
export async function pinch(page: Page, c: { x: number; y: number }, d0: number, d1: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const pts = (d: number) => [
    { x: c.x - d / 2, y: c.y, id: 0 },
    { x: c.x + d / 2, y: c.y, id: 1 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(d0) });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d0 + ((d1 - d0) * i) / 8) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}
```

and replace Task 21's `seedHistory` with a version that reads the image files in Node (the production preview does not serve `tests/fixtures`):

```ts
/**
 * Write a raw record into IndexedDB `meiyan` / `edits` (store/history.ts DB_NAME, STORE_NAME), then reload. Call after
 * `page.goto('/')`. `files.original` / `files.thumb` are local paths; typed arrays inside `record` are passed as plain
 * arrays under `typed: { path: 'f32' | 'u8' }` and rebuilt in the page.
 */
export async function seedHistory(page: Page, record: Record<string, unknown>, files: { original: string; thumb?: string }, typed: Record<string, 'f32' | 'u8'> = {}): Promise<void> {
  const b64 = (p: string) => readFileSync(p).toString('base64');
  await page.evaluate(
    async ({ r, original, thumb, typed }) => {
      const blob = (s: string) => new Blob([Uint8Array.from(atob(s), (c) => c.charCodeAt(0))]);
      const rec = structuredClone(r) as Record<string, unknown>;
      for (const [path, kind] of Object.entries(typed)) {
        const keys = path.split('.');
        let o = rec as Record<string, unknown>;
        for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
        const last = keys[keys.length - 1];
        o[last] = kind === 'f32' ? new Float32Array(o[last] as number[]) : new Uint8Array(o[last] as number[]);
      }
      rec.original = blob(original);
      rec.thumb = blob(thumb);
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const q = indexedDB.open('meiyan', 1);
        q.onupgradeneeded = () => q.result.createObjectStore('edits', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
        q.onsuccess = () => res(q.result);
        q.onerror = () => rej(q.error);
      });
      await new Promise<void>((res, rej) => {
        const tx = db.transaction('edits', 'readwrite');
        tx.objectStore('edits').put(rec);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
      db.close();
    },
    { r: record, original: b64(files.original), thumb: b64(files.thumb ?? files.original), typed },
  );
  await page.reload();
}

/** `updatedAt` of every history record, by id */
export async function historyStamps(page: Page): Promise<Record<string, number>> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const q = indexedDB.open('meiyan', 1);
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
    const all = await new Promise<{ id: string; updatedAt: number }[]>((res, rej) => {
      const q = db.transaction('edits').objectStore('edits').getAll();
      q.onsuccess = () => res(q.result as { id: string; updatedAt: number }[]);
      q.onerror = () => rej(q.error);
    });
    db.close();
    return Object.fromEntries(all.map((e) => [e.id, e.updatedAt]));
  });
}
```

Append to `tests/e2e/persons.spec.ts` (extend the `./fixtures` import with `boxCentre, grab, historyStamps, pinch, regionDiff, seedHistory, selectPerson`; add `import type { Page } from '@playwright/test';`, `readFileSync, writeFileSync` from `node:fs`, `resolve` from `node:path`, `PNG` from `pngjs`, and the four `src` imports of the body-only case below; every import is used, `noUnusedLocals` covers `tests/`):

```ts
const tab = (page: Page, name: string) => page.getByRole('tab', { name }).click();
const option = (page: Page, name: string) => page.getByRole('option', { name, exact: true }).click();
const sliderTo = async (page: Page, v: number) => {
  const s = page.getByRole('slider');
  await s.focus();
  const now = Number(await s.getAttribute('aria-valuenow'));
  for (let i = 0; i < Math.abs(v - now); i++) await page.keyboard.press(v > now ? 'ArrowRight' : 'ArrowLeft');
  await expect(s).toHaveAttribute('aria-valuenow', String(v));
};
const frame = (page: Page) => page.locator('.editor-stage .frame');
/** pixel comparisons read the photo only: the brackets change colour with the selection, toasts come and go */
const hideOverlays = (page: Page) => page.addStyleTag({ content: '.face-boxes, .toast { display: none !important; }' });

test.describe('group photo editing (S §8.4)', () => {
  test.beforeEach(async ({ page }) => {
    await importFixture(page, GROUP_FACES);
    await expect.poll(async () => (await debugState(page)).faces).toBe(3);
  });

  test('brackets and the strip 全部｜1｜2｜3; no box for D', async ({ page }) => {
    await expect(page.getByRole('radiogroup', { name: '選擇人物' }).getByRole('radio')).toHaveCount(4);
    await expect(page.locator('.face-box')).toHaveCount(3);
    expect((await debugState(page)).boxes).toHaveLength(3);
    await expect(page.getByRole('radio', { name: '人物 1' })).toHaveAttribute('aria-checked', 'true');
  });

  test('a tap on face B selects 2; pinch to 3× on A, one-finger drag pans, double tap fits, a tap on B selects B', async ({ page }) => {
    const b = await boxCentre(page, 'f1');
    await page.mouse.click(b.x, b.y);
    await expect(page.getByRole('radio', { name: '人物 2' })).toHaveAttribute('aria-checked', 'true');
    await selectPerson(page, 1);
    const a = await boxCentre(page, 'f0');
    await pinch(page, a, 60, 180);
    const layer = page.locator('.editor-stage .zoom-layer');
    await expect(layer).toHaveAttribute('style', /scale\(/);
    const t0 = await layer.getAttribute('style');
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + 40, a.y + 10, { steps: 6 });
    await page.mouse.up();
    expect(await layer.getAttribute('style')).not.toBe(t0);
    expect((await debugState(page)).selected).toBe('f0');
    await page.mouse.dblclick(a.x + 40, a.y + 10);
    await expect(layer).not.toHaveAttribute('style', /scale\(/);
    await page.waitForTimeout(400); // the fit animates for 240 ms: read B's box once the layer is back at zoom 1
    const b2 = await boxCentre(page, 'f1');
    await page.mouse.click(b2.x, b2.y);
    expect((await debugState(page)).selected).toBe('f1');
  });

  test('大眼 on person 2 changes only B’s region; 全部 + 瘦臉 changes A, B and C', async ({ page }) => {
    await hideOverlays(page);
    await tab(page, '美型');
    const before = await grab(frame(page));
    await selectPerson(page, 2);
    await option(page, '大眼');
    await sliderTo(page, 100);
    await page.waitForTimeout(600);
    const after = await grab(frame(page));
    const B = (await debugState(page)).boxes.find((x) => x.id === 'f1')!;
    const pad = { x: B.x - B.w * 0.6, y: B.y - B.h * 0.6, w: B.w * 2.2, h: B.h * 2.2 };
    const r = regionDiff(before, after, pad);
    expect(r.inside).toBeGreaterThan(0.2);
    expect(r.outsideMax).toBeLessThanOrEqual(1);
    await selectPerson(page, 0);
    await option(page, '瘦臉');
    await sliderTo(page, 100);
    await page.waitForTimeout(600);
    const all = await grab(frame(page));
    for (const id of ['f0', 'f1', 'f2']) {
      const f = (await debugState(page)).boxes.find((x) => x.id === id)!;
      expect(regionDiff(after, all, f).inside, id).toBeGreaterThan(0.05);
    }
  });

  test('全部 + 自然 makes person 2 自然 after 精緻; 美白 is photo-level and dims the chips', async ({ page }) => {
    await tab(page, '一鍵');
    await selectPerson(page, 2);
    await option(page, '精緻');
    await selectPerson(page, 0);
    await option(page, '自然');
    await selectPerson(page, 2);
    await expect(page.getByRole('option', { name: '自然', exact: true })).toHaveAttribute('aria-selected', 'true');
    await tab(page, '美膚');
    await option(page, '美白');
    await expect(page.getByRole('slider')).toHaveAttribute('aria-label', '美白，整張照片');
    await expect(page.locator('.slider-label')).toContainText('美白 · 整張照片');
    await expect(page.getByRole('radio', { name: '人物 1' })).toHaveAttribute('aria-disabled', 'true');
  });

  test('⊘ in 美膚 with person 2 keeps 美白; ↶ restores B’s 大眼, keeps the selection and flags B; an undo of B from person 1 toasts', async ({ page }) => {
    await tab(page, '美膚');
    await option(page, '美白');
    await sliderTo(page, 80);
    await selectPerson(page, 2);
    await page.getByRole('option', { name: '原圖', exact: true }).click();
    await option(page, '美白');
    await expect(page.getByRole('slider')).toHaveAttribute('aria-valuenow', '80');
    await tab(page, '美型');
    await option(page, '大眼');
    await sliderTo(page, 90);
    await page.getByRole('button', { name: '復原' }).click();
    await expect(page.getByRole('radio', { name: '人物 2' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('radio', { name: '人物 2' })).toHaveClass(/changed/);
    await page.getByRole('button', { name: '重做' }).click();
    await selectPerson(page, 1);
    await page.getByRole('button', { name: '復原' }).click();
    await expect(page.getByText('已復原人物 2 的變更')).toBeVisible();
  });

  test('close and reopen: the same pixels, no detector; a view without an edit keeps 最近編輯 and updatedAt', async ({ page }) => {
    await hideOverlays(page);
    await tab(page, '美型');
    await option(page, '大眼');
    await sliderTo(page, 70);
    await page.waitForTimeout(800);
    const pre = await grab(frame(page));
    await page.getByRole('button', { name: '關閉' }).click();
    await expect(page.getByRole('button', { name: '開啟編輯' })).toHaveCount(1, { timeout: 15_000 });
    const stamps = await historyStamps(page);
    const calls = (await debugState(page)).detectCalls;
    await page.getByRole('button', { name: '開啟編輯' }).click();
    await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 60_000 });
    await expect.poll(async () => (await debugState(page)).faces).toBe(3);
    await page.waitForTimeout(1000);
    expect(regionDiff(pre, await grab(frame(page)), { x: 0, y: 0, w: 1, h: 1 }).inside).toBeLessThan(0.5);
    await page.getByRole('button', { name: '關閉' }).click();
    await expect(page.getByRole('button', { name: '開啟編輯' })).toHaveCount(1);
    expect(await historyStamps(page)).toEqual(stamps);
    expect((await debugState(page)).detectCalls).toBe(calls);
  });

  test('two faces survive a WebGL context loss with the same pixels', async ({ page }) => {
    await hideOverlays(page);
    const before = await grab(frame(page));
    await page.evaluate(() => {
      const c = document.querySelector('.editor-stage canvas') as HTMLCanvasElement;
      const ext = (c.getContext('webgl2') as WebGL2RenderingContext).getExtension('WEBGL_lose_context')!;
      ext.loseContext();
      setTimeout(() => ext.restoreContext(), 300);
    });
    await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 60_000 });
    await page.waitForTimeout(1500);
    expect(regionDiff(before, await grab(frame(page)), { x: 0, y: 0, w: 1, h: 1 }).inside).toBeLessThan(0.5);
  });
});

test('a seeded v0.3 record opens with its look on A only', async ({ page }) => {
  await page.goto('/');
  // a lip on (0.3) with the 豆沙 shade: with lip at 0 the strip would show 無 whatever the shade
  const glow = { values: { 'makeup.lip': 0.3, 'makeup.blush': 0.3 }, filterId: 'none', lipShade: 'bean', blushShade: 'peach', presetId: 'glow', presetAmount: 1, bodyProtect: true, heightBand: null };
  await seedHistory(page, { id: 'v1-group', createdAt: 1, updatedAt: 1, width: 1800, height: 1200, params: glow }, { original: GROUP_FACES });
  await page.getByRole('button', { name: '開啟編輯' }).click();
  await expect.poll(async () => (await debugState(page)).faces, { timeout: 90_000 }).toBe(3);
  await page.getByRole('tab', { name: '美妝' }).click();
  await expect(page.getByRole('option', { name: '豆沙', exact: true })).toHaveAttribute('aria-selected', 'true');
  await selectPerson(page, 2);
  await expect(page.getByRole('option', { name: '無', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('a no-face photo reopens with detectCalls unchanged and no toast', async ({ page }) => {
  // a face-free grey gradient (as editor.spec.ts:5 noFacePng)
  const png = new PNG({ width: 600, height: 800 });
  for (let i = 0; i < 600 * 800; i++) {
    const v = 90 + Math.round((70 * ((i % 600) + Math.floor(i / 600))) / 1400);
    png.data.set([v, v, v + 6, 255], i * 4);
  }
  const file = test.info().outputPath('noface.png');
  writeFileSync(file, PNG.sync.write(png));
  await importFixture(page, file);
  await page.waitForTimeout(3500); // the first open's 「未偵測到臉部」 toast is gone
  await page.getByRole('button', { name: '關閉' }).click();
  await expect(page.getByRole('button', { name: '開啟編輯' })).toHaveCount(1, { timeout: 15_000 });
  const calls = (await debugState(page)).detectCalls;
  await page.getByRole('button', { name: '開啟編輯' }).click();
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 60_000 });
  expect((await debugState(page)).detectCalls).toBe(calls);
  await expect(page.locator('.toast')).toHaveCount(0);
});
```

(Imports for these two tests: `PNG` from `pngjs`, `writeFileSync` from `node:fs`. `normalizeEntry` runs `sanitizeParams` on the v1 record, which fills the other `values` with defaults and turns `presetId` into `custom` (the values are not 氣色's); the test reads only the lip the record carries: `'bean'` is 「豆沙」 in `LIP_SHADES`, `params.ts:66`, shown as selected because the lip value is on. Person 2 got the neutral template: 無.)

One more `persons.spec.ts` case seeds a v2 record whose cache has a body-only person (S §8.4); it builds the cache in Node from the recorded landmarks (imports: `editFromLegacy` from `../../src/edit/legacy`, `assignPersons` from `../../src/edit/state`, `applyPreset, sanitizeParams` from `../../src/engine/params`, `stableKey` from `../../src/store/undo` — pure modules):

```ts
test('a body-only person: the no-face note on 美型, 磨皮 / 紅潤 disabled per item on 美膚 (seeded cache)', async ({ page }) => {
  await page.goto('/');
  const j = JSON.parse(readFileSync(resolve(import.meta.dirname, '../fixtures/group_faces.landmarks.json'), 'utf8')) as { width: number; height: number; faces: number[][] };
  const bbox = (lm: number[]) => {
    const xs = lm.filter((_, i) => i % 3 === 0);
    const ys = lm.filter((_, i) => i % 3 === 1);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  };
  const faces = j.faces
    .map((lm) => ({ lm, box: bbox(lm) }))
    .filter((f) => f.box.w * j.width >= 0.03 * j.height)
    .sort((a, b) => a.box.x - b.box.x)
    .map((f, i) => ({ id: `f${i}`, lm: f.lm, box: f.box }));
  // a standing pose at the right edge, all points visible: it pairs with no face, so it is a body-only person
  const pose = Array.from({ length: 132 }, (_, k) => [0.96 + (Math.floor(k / 4) % 2 ? 0.02 : -0.02), 0.1 + (0.8 * Math.floor(k / 4)) / 32, 0, 0.99][k % 4]);
  const ids = [...faces.map((f) => f.id), 'b0'];
  const params = sanitizeParams(applyPreset('natural', 1));
  const edit = assignPersons(editFromLegacy(params, { primaryInit: true }), ids, 'f0');
  const detect = {
    v: 1,
    width: j.width,
    height: j.height,
    faceScans: [{ quarter: 0, flipH: false }],
    faces,
    obstacles: [],
    bodies: [{ id: 'b0', pose: { points: pose }, mask: null, score: 0.1 }],
    bodiesComplete: true,
    persons: ids.map((id) => ({ id, face: id === 'b0' ? null : id, body: id === 'b0' ? 'b0' : null })),
    primary: 'f0',
    dropped: { tooSmall: 0, overCap: 0 },
  };
  const typed: Record<string, 'f32'> = { 'detect.bodies.0.pose.points': 'f32' };
  faces.forEach((_, i) => (typed[`detect.faces.${i}.lm`] = 'f32'));
  await seedHistory(page, { id: 'v2-bodyonly', createdAt: 1, updatedAt: 1, width: j.width, height: j.height, params, schema: 2, edit, paramsKey: stableKey(params), detect }, { original: GROUP_FACES }, typed);
  await page.getByRole('button', { name: '開啟編輯' }).click();
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 60_000 });
  expect((await debugState(page)).detectCalls).toBe(0);
  await page.getByRole('radio', { name: `人物 ${ids.length}（未偵測到臉部）` }).click();
  await page.getByRole('tab', { name: '美型' }).click();
  await expect(page.getByText('這位人物未偵測到臉部，臉部效果不適用')).toBeVisible();
  await page.getByRole('tab', { name: '美膚' }).click();
  await expect(page.getByRole('option', { name: '磨皮', exact: true })).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('option', { name: '美白', exact: true })).not.toHaveAttribute('aria-disabled', 'true');
});
```

Append to `tests/e2e/body.spec.ts` (add `debugState, GROUP_PEOPLE, importFixture, regionDiff` to its `./fixtures` import — `grab` and `resolve` (`node:path`) are imported already — and `import { readFileSync } from 'node:fs';`):

```ts
test.describe('two persons on group_people.jpg (S §8.4)', () => {
  test('a tap on the right body selects person 2; 細腰 on 2 leaves person 1 untouched with λ = 1; bands note only for 增高 / 長腿', async ({ page }) => {
    await importFixture(page, GROUP_PEOPLE);
    await page.getByRole('tab', { name: '美體' }).click();
    await expect.poll(async () => (await debugState(page)).persons, { timeout: 120_000 }).toBeGreaterThanOrEqual(2);
    // the right person's hip centre (pose 23 / 24 of the recorded fixture, Task 1): inside its mask, far from any face box
    const pj = JSON.parse(readFileSync(resolve(import.meta.dirname, '../fixtures/group_people.pose.json'), 'utf8')) as { poses: { points: number[] }[] };
    const hips = pj.poses.map((p) => [(p.points[23 * 4] + p.points[24 * 4]) / 2, (p.points[23 * 4 + 1] + p.points[24 * 4 + 1]) / 2]);
    const [hx, hy] = hips.sort((a, b) => b[0] - a[0])[0];
    const layer = (await page.locator('.editor-stage .zoom-layer').boundingBox())!;
    await page.mouse.click(layer.x + layer.width * hx, layer.y + layer.height * hy);
    await expect(page.getByRole('radio', { name: /^人物 2/ })).toHaveAttribute('aria-checked', 'true');
    await page.addStyleTag({ content: '.face-boxes, .toast { display: none !important; }' });
    const before = await grab(page.locator('.editor-stage .frame'));
    await page.getByRole('option', { name: '細腰', exact: true }).click();
    const s = page.getByRole('slider');
    await s.focus();
    for (let i = 0; i < 60; i++) await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(800);
    const after = await grab(page.locator('.editor-stage .frame'));
    // person 1 stands in the left half: its left 40 % (outside the rect) must not move at all
    expect(regionDiff(before, after, { x: 0.4, y: 0, w: 0.6, h: 1 }).outsideMax).toBeLessThanOrEqual(1);
    expect((await debugState(page)).lambdaGlobal).toBe(1);
    await expect(page.getByText('偵測到多人')).toHaveCount(0);
    await expect(page.getByText('增高、長腿會拉伸整排畫面')).toHaveCount(0);
    await page.getByRole('option', { name: '增高', exact: true }).click();
    await expect(page.getByText('增高、長腿會拉伸整排畫面，套用於整張照片')).toBeVisible();
  });
});
```

- [ ] **Step 7: Bench rows PE and M (`src/bench/multiFace.ts`, append)**

```ts
/** PE: an editor-like drag on group6_faces.png at 2048 — every face item + 磨皮 on every person; p50 frame time */
export async function rowPE(): Promise<MultiRow[]> {
  const { prepareFaces } = await import('../detect/faces');
  const { buildCache } = await import('../detect/cache');
  const { createStillSession } = await import('../app/still');
  const { createEngine } = await import('../engine/index');
  const { createTracker } = await import('../tracking/tracker');
  const { buildFrame } = await import('../edit/frame');
  const { assignPersons } = await import('../edit/state');
  const { editFromLegacy } = await import('../edit/legacy');
  const { applyPreset, paramsInGroup, setParam } = await import('../engine/params');
  const { modelBuffer } = await loadEngineAssets();
  const t = await createTracker({ modelBuffer, wasmBase: ENGINE_PATHS.wasmBase, delegate: 'auto' });
  const bmp = await decode(await (await fetch('/tests/fixtures/group6_faces.png')).blob(), 2048);
  const prepared = prepareFaces(t.detectImage(bmp, { maxFaces: 8 }), bmp.width, bmp.height);
  t.close();
  const cache = buildCache({ width: bmp.width, height: bmp.height }, prepared, null, { faceScans: [{ quarter: 0, flipH: false }] });
  const canvas = document.createElement('canvas');
  const engine = createEngine(canvas, { mirror: false });
  await engine.ready;
  const s = createStillSession(engine, null, bmp, { faces: cache.faces, obstacles: cache.obstacles });
  const faceItems = ['skin.smooth', ...paramsInGroup('shape').map((d) => d.id)];
  const look = faceItems.reduce((p, id) => setParam(p, id as never, 0.7), applyPreset('natural', 1));
  const ids = cache.persons.map((p) => p.id);
  const gl = engine.canvas.getContext('webgl2')!;
  const px = new Uint8Array(4);
  const times: number[] = [];
  for (let i = 0; i < 40; i++) {
    // every person carries the look (template = the look), the drag moves 大眼 for everyone
    const e0 = editFromLegacy(setParam(look, 'shape.eyeEnlarge', 0.5 + (i % 10) / 20), { primaryInit: true });
    const edit = assignPersons({ ...e0, template: e0.persons.p0 }, ids, cache.primary);
    const frame = buildFrame(edit, s.faces.map((f) => ({ id: f.id, face: f.face, person: f.id })), cache.obstacles, new Map(), cache.primary);
    const t0 = performance.now();
    engine.render({ source: bmp, width: bmp.width, height: bmp.height, ...frame }, { still: true });
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // wait for the GPU (iOS has no timer query)
    times.push(performance.now() - t0);
  }
  s.dispose();
  engine.dispose();
  times.sort((a, b) => a - b);
  return [{ row: 'PE', config: `${cache.faces.length} faces 2048`, values: { p50_ms: Math.round(times[20] * 10) / 10 } }];
}
addRunner('PE', () => rowPE());

const M_KEY = 'meiyan.bench.m';
/** M (kill test, S §6.2): open group_people.jpg, detect every body (numPoses 4) and measure, 3 times; a breadcrumb left
 * behind by a killed page is reported on the next load */
export async function rowM(): Promise<MultiRow[]> {
  const { createBodyTracker } = await import('../tracking/bodyTracker');
  const { measureBody } = await import('../body/measure');
  const out: MultiRow[] = [];
  for (let run = 1; run <= 3; run++) {
    localStorage.setItem(M_KEY, String(run));
    const bmp = await decode(await (await fetch('/tests/fixtures/group_people.jpg')).blob(), 2048);
    const bt = await createBodyTracker({ modelBuffer: await loadPoseModel('full'), wasmBase: ENGINE_PATHS.wasmBase, variant: 'full' });
    const d = bt.detect(bmp);
    for (const b of d?.bodies ?? []) measureBody({ pose: b.pose, mask: b.mask, people: 1, width: bmp.width, height: bmp.height }, null);
    bt.close();
    bmp.close();
    localStorage.removeItem(M_KEY);
    out.push({ row: 'M', config: `run ${run}`, values: { persons: d?.bodies.length ?? 0, heapMB: Math.round(((performance as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1e6) } });
  }
  return out;
}
addRunner('M', () => rowM());
/** a page killed during M leaves its breadcrumb: report it once */
export function staleKill(): MultiRow | null {
  const run = localStorage.getItem(M_KEY);
  if (run === null) return null;
  localStorage.removeItem(M_KEY);
  return { row: 'M', config: `killed during run ${run}`, values: { killed: 1 } };
}
```

In `mountMultiFace`: add `'PE', 'M'` to the buttons list, and at its start `const killed = staleKill(); if (killed) rows.push(killed);`. (`BodyTrackerOptions`, `types.ts:211-226`: `modelBuffer`, `wasmBase`, `variant`; masks default on. The `/tests/fixtures/` URLs resolve on the dev server, where the bench runs.)

- [ ] **Step 8: Sub-step 1d gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green.

Run: `npm run test:e2e`
Expected: every spec passes, including `parity.spec.ts`, `persons.spec.ts` and the new `body.spec.ts` case.

- [ ] **Step 9: Commit**

```bash
git add src tests/e2e
git commit -m "v0.4 step 1d: person strip, face boxes, photo taps, selection, 全部 and the editor toasts"
```

---

## Sub-step 1e — Camera tracks, tap-to-select, 全部套用 and the seed hand-over

### Task 24: One-Euro smoothing, face tracks, the tap table, the chip gate and the seed mapping (pure)

**Files:**
- Create: `src/app/oneEuro.ts`, `src/app/oneEuro.test.ts`, `src/app/faceTracks.ts`, `src/app/faceTracks.test.ts`
- Modify: `src/ui/imaging.ts` (append `shotSeed`), `src/ui/ui.test.ts` (append)

**Interfaces:**
- Consumes: `ONE_EURO`, `LOST_HOLD_MS`, `MAX_LIVE_FACES` (limits), `FaceWeightEaser`, `FACE_EASE_MS` (`liveCore.ts:6, 50-74`), `adapt` (`adapter111.ts:106`), `ovalBox` (Task 13), `boxIoU` (Task 13), `centerCropRect` (`imaging.ts:12`).
- Produces:

```ts
// src/app/oneEuro.ts
export class OneEuro { constructor(minCutoff?: number, beta?: number, dCutoff?: number); apply(value: number, tsMs: number, valueScale: number): number }
export class LandmarkSmoother { constructor(n?: number); apply(points: Float32Array, w: number, h: number, tsMs: number): Float32Array }
// src/app/faceTracks.ts
export type TrackId = number;
export type CameraSelection = 'auto' | TrackId;
export interface LiveTrackView { id: TrackId; box: Rect; rawBox: Rect; face: Face; weight: number; presence: number; beautified: boolean; present: boolean }
export class FaceTracks {
  constructor(opts?: { maxFaces?: number; holdMs?: number });
  detect(lms: readonly Landmarks478[] | null, tsMs: number, w: number, h: number): void;
  step(dtMs: number, all: boolean, nowMs: number): void;
  views(): LiveTrackView[];
  readonly anyFace: number;
  beautified(): LiveTrackView | null;
  select(id: TrackId): void;
  selection(): CameraSelection;
  hitTest(u: number, v: number, minW: number, minH: number): TrackId | null;
  reset(): void;
}
export type TapAction = { kind: 'collapse' } | { kind: 'select'; id: TrackId; allOff: boolean };
export function cameraTapAction(hit: TrackId | null, shownTracks: number, selection: CameraSelection, allOn: boolean): TapAction;
export function coverTapUv(x: number, y: number, rect: { left: number; top: number; width: number; height: number }, vw: number, vh: number, mirrored: boolean): { u: number; v: number; minW: number; minH: number };
export function videoToFrame(u: number, v: number, rect: { width: number; height: number }, vw: number, vh: number, mirrored: boolean): [number, number];
export class ChipGate { update(shownTracks: number, allOn: boolean, nowMs: number): boolean }
// src/ui/imaging.ts
export function shotSeed(seed: { x: number; y: number } | 'all' | null, vw: number, vh: number, ratio: number, mirrored: boolean): FaceSeed;
```

- [ ] **Step 1: Failing tests**

```ts
// src/app/oneEuro.test.ts
import { describe, expect, it } from 'vitest';
import { LandmarkSmoother, OneEuro } from './oneEuro';

describe('OneEuro (MediaPipe one_euro_filter.cc, S §3.4 T4)', () => {
  it('a constant input is returned unchanged from the first sample on', () => {
    const f = new OneEuro();
    // α·v + (1 − α)·v may round off v by an ulp: compare to 9 decimals
    for (let i = 0; i < 30; i++) expect(f.apply(123.5, i * 33, 1 / 200)).toBeCloseTo(123.5, 9);
  });
  it('a step converges', () => {
    const f = new OneEuro();
    f.apply(0, 0, 1 / 200);
    let y = 0;
    for (let i = 1; i <= 90; i++) y = f.apply(100, i * 33.3, 1 / 200);
    expect(y).toBeCloseTo(100, 2);
  });
  it('lags ≤ 10 ms at one face size per second (30 fps)', () => {
    const size = 200;
    const f = new OneEuro();
    let lagMs = Infinity;
    for (let i = 0; i <= 60; i++) {
      const t = i * 33.3;
      const x = (size * t) / 1000;
      const y = f.apply(x, t, 1 / size);
      lagMs = ((x - y) / size) * 1000;
    }
    expect(lagMs).toBeGreaterThanOrEqual(0);
    expect(lagMs).toBeLessThanOrEqual(10);
  });
  it('a repeated or older timestamp returns the value unfiltered and changes nothing', () => {
    const f = new OneEuro();
    f.apply(10, 100, 1);
    expect(f.apply(50, 100, 1)).toBe(50); // returned as is
    expect(f.apply(10, 133, 1)).toBeCloseTo(10, 9); // the 50 never entered the state
  });
});

describe('LandmarkSmoother', () => {
  const pts = (dx: number) => {
    const p = new Float32Array(478 * 3);
    for (let i = 0; i < 478; i++) {
      p[i * 3] = 0.4 + (0.2 * ((i * 37) % 100)) / 100 + dx;
      p[i * 3 + 1] = 0.4 + (0.2 * ((i * 53) % 100)) / 100;
      p[i * 3 + 2] = 0.01;
    }
    return p;
  };
  it('is scale invariant: the same normalized motion at twice the resolution gives the same output', () => {
    const a = new LandmarkSmoother();
    const b = new LandmarkSmoother();
    let oa = new Float32Array(0);
    let ob = new Float32Array(0);
    for (let i = 0; i < 20; i++) {
      oa = a.apply(pts(i * 0.002), 640, 480, i * 33);
      ob = b.apply(pts(i * 0.002), 1280, 960, i * 33);
    }
    for (let k = 0; k < oa.length; k++) expect(Math.abs(oa[k] - ob[k])).toBeLessThan(1e-6);
  });
  it('one filter per landmark coordinate: a still point stays put while another moves', () => {
    const s = new LandmarkSmoother();
    let out = new Float32Array(0);
    for (let i = 0; i < 20; i++) {
      const p = pts(0);
      p[5 * 3] += i * 0.01;
      out = s.apply(p, 640, 480, i * 33);
    }
    expect(out[7 * 3]).toBeCloseTo(pts(0)[7 * 3], 6);
    expect(out[5 * 3]).toBeGreaterThan(pts(0)[5 * 3] + 0.1);
  });
});
```

```ts
// src/app/faceTracks.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { adapt } from '../tracking/adapter111';
import type { Landmarks478 } from '../types';
import { FaceWeightEaser } from './liveCore';
import { cameraTapAction, ChipGate, coverTapUv, FaceTracks, videoToFrame } from './faceTracks';

const sample = JSON.parse(readFileSync(new URL('../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as { points: number[] };
/** the recorded sample face moved so its points' bbox is centred at (cx, cy) with width w (UV) */
function lmAt(cx: number, cy: number, w: number): Landmarks478 {
  const p = sample.points;
  let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
  for (let i = 0; i < 478; i++) {
    x0 = Math.min(x0, p[i * 3]); x1 = Math.max(x1, p[i * 3]);
    y0 = Math.min(y0, p[i * 3 + 1]); y1 = Math.max(y1, p[i * 3 + 1]);
  }
  const s = w / (x1 - x0);
  const out = new Float32Array(478 * 3);
  for (let i = 0; i < 478; i++) {
    out[i * 3] = cx + (p[i * 3] - (x0 + x1) / 2) * s;
    out[i * 3 + 1] = cy + (p[i * 3 + 1] - (y0 + y1) / 2) * s;
    out[i * 3 + 2] = p[i * 3 + 2] * s;
  }
  return { points: out };
}
const W = 1280;
const H = 720;
/** run detections at 30 fps; returns the time after the last frame */
function run(t: FaceTracks, frames: number, at: (i: number) => readonly Landmarks478[] | null, t0 = 0, all = false): number {
  let now = t0;
  for (let i = 0; i < frames; i++) {
    now = t0 + i * 33;
    t.detect(at(i), now, W, H);
    t.step(33, all, now);
  }
  return now;
}
const A = (dx = 0) => lmAt(0.3 + dx, 0.5, 0.2);
const B = (w = 0.2) => lmAt(0.7, 0.5, w);

describe('FaceTracks (S §3.4 T4)', () => {
  it('matches by IoU across frames, and by centre when the face doubles in size at once (IoU 0.25); ids stay', () => {
    const t = new FaceTracks();
    run(t, 3, (i) => [A(i * 0.01)]);
    const id = t.views()[0].id;
    run(t, 1, () => [lmAt(0.32, 0.5, 0.4)], 200);
    expect(t.views().map((v) => v.id)).toEqual([id]);
  });
  it('two detections converged on one face are one track', () => {
    const t = new FaceTracks();
    run(t, 5, () => [A(), A(0.002)]);
    expect(t.views()).toHaveLength(1);
  });
  it('no answer (null) keeps the tracks and the selection; the weights ease out', () => {
    const t = new FaceTracks();
    run(t, 10, () => [A(), B()]);
    const b = t.views().find((v) => v.box.x > 0.5)!.id;
    t.select(b);
    run(t, 10, () => [A(), B()], 400);
    run(t, 60, () => null, 800);
    expect(t.views()).toHaveLength(2);
    expect(t.selection()).toBe(b);
    expect(t.views().every((v) => v.weight === 0)).toBe(true);
  });
  it('a missing track is held for LOST_HOLD_MS, then dropped; a pinned selection returns to auto', () => {
    const t = new FaceTracks();
    run(t, 10, () => [A(), B()]);
    const b = t.views().find((v) => v.box.x > 0.5)!.id;
    t.select(b);
    run(t, 25, () => [A()], 400); // 800 ms without B
    expect(t.views()).toHaveLength(2);
    run(t, 10, () => [A()], 1300);
    expect(t.views()).toHaveLength(1);
    expect(t.selection()).toBe('auto');
  });
  it('Review Focus #4: a no-answer stretch longer than LOST_HOLD_MS (a context loss) does not age the hold (S §3.4 T4)', () => {
    const t = new FaceTracks();
    run(t, 10, () => [A(), B()]);
    const b = t.views().find((v) => v.box.x > 0.5)!.id;
    t.select(b);
    run(t, 90, () => null, 400); // 3 s without an answer
    run(t, 15, () => [A()], 3400); // answers again, B missed for the first 460 ms
    expect(t.views()).toHaveLength(2);
    expect(t.selection()).toBe(b);
    run(t, 5, () => [A(), B()], 3900); // found again near its last centre: the same track, still pinned
    expect(t.beautified()!.id).toBe(b);
  });
  it('auto picks the largest and switches only after another stays ≥ 1.2× larger for 500 ms (A7)', () => {
    const t = new FaceTracks();
    run(t, 10, () => [A(), B(0.15)]);
    const a = t.beautified()!.id;
    expect(t.views().find((v) => v.id === a)!.box.x).toBeLessThan(0.5);
    let now = run(t, 12, () => [A(), B(0.24)], 400); // 1.44× for 363 ms: not yet
    expect(t.beautified()!.id).toBe(a);
    now = run(t, 10, () => [A(), B(0.24)], now + 33); // the smoothed box needs a frame or two to pass 1.2×
    expect(t.beautified()!.id).not.toBe(a);
    const t2 = new FaceTracks();
    run(t2, 30, () => [A(), B(0.21)]); // 1.1×: never
    expect(t2.views().find((v) => v.id === t2.beautified()!.id)!.box.x).toBeLessThan(0.5);
  });
  it('Review Focus #4: a second face flickering in every other detection never takes the beautify, even when larger', () => {
    const t = new FaceTracks();
    run(t, 10, () => [A()]);
    const a = t.beautified()!.id;
    run(t, 120, (i) => (i % 2 ? [A(), B(0.3)] : [A()]), 400);
    expect(t.beautified()!.id).toBe(a);
  });
  it('a selection switch crossfades over 150 ms; the presence easer follows presence only', () => {
    const t = new FaceTracks();
    // B slightly smaller, so auto picks A deterministically (two equal boxes differ only by float rounding)
    run(t, 10, () => [A(), B(0.19)]);
    const [va, vb] = [...t.views()].sort((x, y) => x.box.x - y.box.x);
    expect([va.weight, vb.weight]).toEqual([1, 0]);
    expect(vb.presence).toBe(1);
    t.select(vb.id);
    t.detect([A(), B()], 400, W, H);
    t.step(75, false, 475);
    const mid = t.views();
    expect(mid.find((v) => v.id === va.id)!.weight).toBeGreaterThan(0);
    expect(mid.find((v) => v.id === vb.id)!.weight).toBeGreaterThan(0);
    t.step(100, false, 575);
    expect(t.views().find((v) => v.id === vb.id)!.weight).toBe(1);
    expect(t.views().find((v) => v.id === va.id)!.weight).toBe(0);
  });
  it('one face: the weight and anyFace equal v0.3’s single easer, frame by frame (live parity)', () => {
    const t = new FaceTracks();
    const e = new FaceWeightEaser();
    const seq = [1, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 1];
    seq.forEach((present, i) => {
      t.detect(present ? [A()] : [], i * 33, W, H);
      t.step(33, false, i * 33);
      const want = e.update(present === 1, 33);
      expect(t.anyFace).toBe(want);
      expect(t.views()[0]?.weight ?? 0).toBe(want);
    });
  });
  it('with maxFaces 1 the smoother is bypassed: the shown face is the raw one (v0.3)', () => {
    const t = new FaceTracks({ maxFaces: 1 });
    run(t, 3, (i) => [A(i * 0.01)]);
    expect(Array.from(t.views()[0].face.pts111)).toEqual(Array.from(adapt(A(0.02), W, H).pts111));
  });
  it('hitTest: boxes grown to the 44 pt minimum, nearest centre among several', () => {
    const t = new FaceTracks();
    run(t, 5, () => [A(), B()]);
    const [va, vb] = [...t.views()].sort((x, y) => x.box.x - y.box.x);
    expect(t.hitTest(va.box.x + va.box.w / 2, 0.5, 0.01, 0.01)).toBe(va.id);
    expect(t.hitTest(0.5, 0.5, 0.01, 0.01)).toBeNull();
    expect(t.hitTest(0.5, 0.5, 0.9, 0.9)).not.toBeNull();
    expect(t.hitTest(vb.box.x + vb.box.w / 2, 0.5, 0.9, 0.9)).toBe(vb.id);
  });
});

describe('cameraTapAction (S §2.5)', () => {
  it('every row of the table', () => {
    expect(cameraTapAction(1, 1, 'auto', false)).toEqual({ kind: 'collapse' });
    expect(cameraTapAction(2, 2, 'auto', true)).toEqual({ kind: 'select', id: 2, allOff: true });
    expect(cameraTapAction(2, 2, 'auto', false)).toEqual({ kind: 'select', id: 2, allOff: false });
    expect(cameraTapAction(2, 3, 1, false)).toEqual({ kind: 'select', id: 2, allOff: false });
    expect(cameraTapAction(2, 2, 2, false)).toEqual({ kind: 'collapse' });
    expect(cameraTapAction(null, 2, 2, false)).toEqual({ kind: 'collapse' });
    expect(cameraTapAction(null, 3, 'auto', true)).toEqual({ kind: 'collapse' });
  });
});

describe('cover mapping (S §3.4 C1)', () => {
  const rect = { left: 10, top: 20, width: 390, height: 520 };
  it('a tap maps to unmirrored video UV and back', () => {
    for (const mirrored of [false, true]) {
      const [x, y] = videoToFrame(0.6, 0.4, rect, 1280, 720, mirrored);
      const r = coverTapUv(rect.left + x, rect.top + y, rect, 1280, 720, mirrored);
      expect(r.u).toBeCloseTo(0.6, 9);
      expect(r.v).toBeCloseTo(0.4, 9);
    }
  });
  it('the front camera mirrors u; 44 pt in video UV at the cover scale', () => {
    const s = Math.max(390 / 1280, 520 / 720);
    const r = coverTapUv(rect.left + 195, rect.top + 100, rect, 1280, 720, true);
    expect(r.u).toBeCloseTo(0.5, 9);
    expect(r.minW).toBeCloseTo(44 / (s * 1280), 9);
    expect(r.minH).toBeCloseTo(44 / (s * 720), 9);
  });
});

describe('ChipGate (S §2.5: 300 ms on, 1200 ms off, never off while 全部套用 is on)', () => {
  it('debounces both ways and does not blink with a flickering second face (Review Focus #4)', () => {
    const g = new ChipGate();
    expect(g.update(2, false, 0)).toBe(false);
    expect(g.update(2, false, 250)).toBe(false);
    expect(g.update(2, false, 300)).toBe(true);
    for (let t = 400; t < 4000; t += 100) expect(g.update(t % 200 ? 1 : 2, false, t)).toBe(true);
    expect(g.update(1, false, 4100)).toBe(true);
    expect(g.update(1, false, 5300)).toBe(false);
    expect(g.update(0, true, 5400)).toBe(true);
    expect(g.update(0, true, 9000)).toBe(true);
  });
  it('a flicker that never holds two faces for 300 ms never shows it', () => {
    const g = new ChipGate();
    for (let t = 0; t < 3000; t += 100) expect(g.update(t % 200 ? 1 : 2, false, t)).toBe(false);
  });
});
```

Append to `src/ui/ui.test.ts` (import `shotSeed` with `centerCropRect`):

```ts
describe('camera → editor seed (S §3.4 C2)', () => {
  it('maps into the saved crop, mirrors with the saved image, never clamps', () => {
    const r = centerCropRect(1280, 720, 3 / 4); // 540 × 720 at x 370
    expect(shotSeed({ x: 0.5, y: 0.5 }, 1280, 720, 3 / 4, false)).toEqual({ x: (640 - r.x) / r.width, y: 0.5 });
    expect(shotSeed({ x: 0.5, y: 0.25 }, 1280, 720, 3 / 4, true)).toEqual({ x: 1 - (640 - r.x) / r.width, y: 0.25 });
    expect((shotSeed({ x: 0.1, y: 0.5 }, 1280, 720, 3 / 4, false) as { x: number }).x).toBeLessThan(0);
    expect(shotSeed('all', 1280, 720, 1, false)).toBe('all');
    expect(shotSeed(null, 1280, 720, 1, false)).toBeNull();
  });
});
```

Run: `npx vitest run src/app/oneEuro.test.ts src/app/faceTracks.test.ts src/ui/ui.test.ts`
Expected: FAIL (cannot resolve `./oneEuro` / `./faceTracks`; `shotSeed` missing).

- [ ] **Step 2: `src/app/oneEuro.ts`**

```ts
// MediaPipe's own landmark smoother, replicated for the multi-face camera (S §3.4 T4, RM §3.7): one One-Euro filter
// per landmark coordinate, on values in source pixels, with the derivative scaled by 1 / face size, exactly as
// mediapipe/util/filtering/one_euro_filter.cc and LandmarksSmoothingCalculator do with the face-landmarks graph's
// options (ONE_EURO). MediaPipe smooths only at numFaces 1; with more faces the app does it.
import { ONE_EURO } from '../config/limits';

class LowPass {
  private stored = 0;
  private raw = 0;
  private init = false;
  get hasRaw(): boolean {
    return this.init;
  }
  get lastRaw(): number {
    return this.raw;
  }
  apply(value: number, alpha: number): number {
    const out = this.init ? alpha * value + (1 - alpha) * this.stored : value;
    this.init = true;
    this.raw = value;
    this.stored = out;
    return out;
  }
}

export class OneEuro {
  private readonly x = new LowPass();
  private readonly dx = new LowPass();
  /** Hz; MediaPipe starts at 30 and re-derives it from every timestamp pair */
  private frequency = 30;
  private lastMs = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly minCutoff: number = ONE_EURO.minCutoff,
    private readonly beta: number = ONE_EURO.beta,
    private readonly dCutoff: number = ONE_EURO.dCutoff,
  ) {}

  private alpha(cutoff: number): number {
    const te = 1 / this.frequency;
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / te);
  }

  /** MediaPipe's Apply(timestamp, value_scale, value): an equal or older timestamp returns the value as is */
  apply(value: number, tsMs: number, valueScale: number): number {
    if (tsMs <= this.lastMs) return value;
    if (Number.isFinite(this.lastMs)) this.frequency = 1000 / (tsMs - this.lastMs);
    this.lastMs = tsMs;
    const dvalue = this.x.hasRaw ? (value - this.x.lastRaw) * valueScale * this.frequency : 0;
    const edvalue = this.dx.apply(dvalue, this.alpha(this.dCutoff));
    const cutoff = this.minCutoff + this.beta * Math.abs(edvalue);
    return this.x.apply(value, this.alpha(cutoff));
  }
}

/** One face's 478×3 landmarks: x·W, y·H, z·W filtered per coordinate, the derivative scaled by 1 / ((boxW + boxH) / 2) */
export class LandmarkSmoother {
  private readonly f: OneEuro[];

  constructor(private readonly n = 478) {
    this.f = Array.from({ length: n * 3 }, () => new OneEuro());
  }

  apply(points: Float32Array, w: number, h: number, tsMs: number): Float32Array {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < this.n; i++) {
      const x = points[i * 3] * w;
      const y = points[i * 3 + 1] * h;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    const size = (x1 - x0 + (y1 - y0)) / 2;
    const scale = size > 0 && Number.isFinite(size) ? 1 / size : 1;
    const out = new Float32Array(points.length);
    for (let i = 0; i < this.n; i++) {
      out[i * 3] = this.f[i * 3].apply(points[i * 3] * w, tsMs, scale) / w;
      out[i * 3 + 1] = this.f[i * 3 + 1].apply(points[i * 3 + 1] * h, tsMs, scale) / h;
      out[i * 3 + 2] = this.f[i * 3 + 2].apply(points[i * 3 + 2] * w, tsMs, scale) / w;
    }
    return out;
  }
}
```

- [ ] **Step 3: `src/app/faceTracks.ts`**

```ts
// Camera face tracks (S §3.4 T4): de-duplicate, match, hold, smooth (MediaPipe's smoother, bypassed at one face),
// select (auto = the largest with the A7 hysteresis, or a pinned track) and ease each face's beautify weight, its
// presence (the neighbours' caps, A3) and the any-face weight (the global skin, A2). Pure: no DOM, no GL.
import { LOST_HOLD_MS, MAX_LIVE_FACES } from '../config/limits';
import { boxIoU } from '../detect/faces';
import { ovalBox } from '../engine/passes/faceCap';
import { adapt } from '../tracking/adapter111';
import type { Face, Landmarks478, Rect } from '../types';
import { FaceWeightEaser } from './liveCore';
import { LandmarkSmoother } from './oneEuro';

export type TrackId = number;
export type CameraSelection = 'auto' | TrackId;

export interface LiveTrackView {
  id: TrackId;
  /** the shown (smoothed) face's oval box, unmirrored video UV */
  box: Rect;
  /** the last raw detection's box: the hand-over seed (C2) */
  rawBox: Rect;
  face: Face;
  /** beautify weight 0..1 */
  weight: number;
  /** presence 0..1: scales this face's part in its neighbours' caps (A3) */
  presence: number;
  /** the face beautified without 全部套用 (the pinned one, else the auto pick) */
  beautified: boolean;
  /** found by the last detection (false while held) */
  present: boolean;
}

interface Track {
  id: TrackId;
  filter: LandmarkSmoother | null;
  shown: Face;
  box: Rect;
  rawBox: Rect;
  present: boolean;
  lastSeen: number;
  easer: FaceWeightEaser;
  presence: FaceWeightEaser;
}

interface Det {
  lm: Landmarks478;
  face: Face;
  box: Rect;
}

/** A7: auto switches only to a face ≥ 1.2× larger for 500 ms */
const AUTO_RATIO = 1.2;
const AUTO_HOLD_MS = 500;
const area = (b: Rect) => b.w * b.h;
const centre = (b: Rect): [number, number] => [b.x + b.w / 2, b.y + b.h / 2];
const finiteBox = (b: Rect) => b.w > 0 && b.h > 0 && Number.isFinite(b.x + b.y + b.w + b.h);

export class FaceTracks {
  private list: Track[] = [];
  private nextId = 1;
  private sel: CameraSelection = 'auto';
  private autoId: TrackId | null = null;
  private challenger: { id: TrackId; since: number } | null = null;
  private readonly any = new FaceWeightEaser();
  private readonly max: number;
  private readonly hold: number;
  /** a no-answer stretch began here: the hold clock is paused until the next answer (S §3.4 T4, A5) */
  private noAnswerSince: number | null = null;

  constructor(opts: { maxFaces?: number; holdMs?: number } = {}) {
    this.max = Math.max(1, opts.maxFaces ?? MAX_LIVE_FACES);
    this.hold = opts.holdMs ?? LOST_HOLD_MS;
  }

  /** a detecting frame. null = no answer: tracks and selection held, every easer eases out (A5); [] = no face */
  detect(lms: readonly Landmarks478[] | null, tsMs: number, w: number, h: number): void {
    if (lms === null) {
      for (const t of this.list) t.present = false;
      this.noAnswerSince ??= tsMs;
      return;
    }
    if (this.noAnswerSince !== null) {
      // "lastSeen does not age" while the tracker cannot answer (a context loss, the rebuild throttle): the hold resumes
      // where it stopped, so a face missed on the first frames back is still held and a pinned selection survives
      const paused = Math.max(0, tsMs - this.noAnswerSince);
      for (const t of this.list) t.lastSeen += paused;
      this.noAnswerSince = null;
    }
    const dets: Det[] = [];
    for (const lm of lms) {
      const face = adapt(lm, w, h);
      const box = ovalBox(face);
      if (finiteBox(box)) dets.push({ lm, face, box });
    }
    // two ROIs converged on one face (IoU > 0.6, T3's rule): keep the one matching a track, else the larger
    const onTrack = (b: Rect) => this.list.some((t) => boxIoU(t.box, b) >= 0.3);
    dets.sort((a, b) => area(b.box) - area(a.box));
    const unique: Det[] = [];
    for (const d of dets) {
      const j = unique.findIndex((u) => boxIoU(u.box, d.box) > 0.6);
      if (j < 0) unique.push(d);
      else if (!onTrack(unique[j].box) && onTrack(d.box)) unique[j] = d;
    }
    // match: greedy by IoU ≥ 0.3, then the nearest centre within half a box width
    const free = new Set(this.list);
    const used = new Set<Det>();
    const pairs: [Track, Det][] = [];
    const cand = this.list
      .flatMap((t) => unique.map((d) => ({ t, d, iou: boxIoU(t.box, d.box) })))
      .filter((c) => c.iou >= 0.3)
      .sort((a, b) => b.iou - a.iou);
    for (const c of cand) {
      if (!free.has(c.t) || used.has(c.d)) continue;
      free.delete(c.t);
      used.add(c.d);
      pairs.push([c.t, c.d]);
    }
    for (const t of [...free]) {
      const [tx, ty] = centre(t.box);
      let best: Det | null = null;
      let bestD = 0.5 * t.box.w;
      for (const d of unique) {
        if (used.has(d)) continue;
        const [dx, dy] = centre(d.box);
        const dist = Math.hypot(dx - tx, dy - ty);
        if (dist <= bestD) {
          bestD = dist;
          best = d;
        }
      }
      if (!best) continue;
      free.delete(t);
      used.add(best);
      pairs.push([t, best]);
    }
    for (const [t, d] of pairs) this.feed(t, d, tsMs, w, h);
    for (const t of free) t.present = false;
    // unmatched detections start tracks, largest first, while there is room; ids count up per session
    for (const d of unique) {
      if (used.has(d) || this.list.length >= this.max) continue;
      const t: Track = {
        id: this.nextId++,
        filter: this.max > 1 ? new LandmarkSmoother() : null,
        shown: d.face,
        box: d.box,
        rawBox: d.box,
        present: true,
        lastSeen: tsMs,
        easer: new FaceWeightEaser(),
        presence: new FaceWeightEaser(),
      };
      this.feed(t, d, tsMs, w, h);
      this.list.push(t);
    }
    this.list = this.list.filter((t) => t.present || tsMs - t.lastSeen <= this.hold);
    if (this.sel !== 'auto' && !this.list.some((t) => t.id === this.sel)) this.sel = 'auto';
    if (this.autoId !== null && !this.list.some((t) => t.id === this.autoId)) this.autoId = null;
  }

  private feed(t: Track, d: Det, tsMs: number, w: number, h: number): void {
    t.rawBox = d.box;
    t.present = true;
    t.lastSeen = tsMs;
    if (t.filter) {
      t.shown = adapt({ points: t.filter.apply(d.lm.points, w, h, tsMs) }, w, h);
      const b = ovalBox(t.shown);
      t.box = finiteBox(b) ? b : d.box;
    } else {
      // MAX_LIVE_FACES = 1: MediaPipe smooths at numFaces 1; the shown face is the raw one (v0.3)
      t.shown = d.face;
      t.box = d.box;
    }
  }

  /** every frame (tracks hold between detections): the A7 auto pick, then the easers */
  step(dtMs: number, all: boolean, nowMs: number): void {
    const present = this.list.filter((t) => t.present);
    const largest = present.reduce<Track | null>((a, t) => (!a || area(t.box) > area(a.box) ? t : a), null);
    if (this.autoId === null) {
      this.autoId = largest?.id ?? null;
      this.challenger = null;
    } else if (largest && largest.id !== this.autoId) {
      const cur = this.list.find((t) => t.id === this.autoId)!;
      if (area(largest.box) >= AUTO_RATIO * area(cur.box)) {
        if (this.challenger?.id !== largest.id) this.challenger = { id: largest.id, since: nowMs };
        else if (nowMs - this.challenger.since >= AUTO_HOLD_MS) {
          this.autoId = largest.id;
          this.challenger = null;
        }
      } else this.challenger = null;
    } else this.challenger = null;
    const target = this.sel === 'auto' ? this.autoId : this.sel;
    for (const t of this.list) {
      t.easer.update(t.present && (all || t.id === target), dtMs);
      t.presence.update(t.present, dtMs);
    }
    this.any.update(present.length > 0, dtMs);
  }

  views(): LiveTrackView[] {
    const target = this.sel === 'auto' ? this.autoId : this.sel;
    return this.list.map((t) => ({
      id: t.id,
      box: t.box,
      rawBox: t.rawBox,
      face: t.shown,
      weight: t.easer.value,
      presence: t.presence.value,
      beautified: t.id === target,
      present: t.present,
    }));
  }

  /** "any face present", eased: 1 − it is the global skin's weight (A2); one face: today's single easer */
  get anyFace(): number {
    return this.any.value;
  }

  beautified(): LiveTrackView | null {
    return this.views().find((v) => v.beautified) ?? null;
  }

  select(id: TrackId): void {
    if (this.list.some((t) => t.id === id)) this.sel = id;
  }

  selection(): CameraSelection {
    return this.sel;
  }

  /** the shown track under (u, v), each box grown to at least minW × minH about its centre; nearest centre wins */
  hitTest(u: number, v: number, minW: number, minH: number): TrackId | null {
    let best: TrackId | null = null;
    let bestD = Infinity;
    for (const t of this.list) {
      const [cx, cy] = centre(t.box);
      const hw = Math.max(t.box.w, minW) / 2;
      const hh = Math.max(t.box.h, minH) / 2;
      if (Math.abs(u - cx) > hw || Math.abs(v - cy) > hh) continue;
      const d = Math.hypot(u - cx, v - cy);
      if (d < bestD) {
        bestD = d;
        best = t.id;
      }
    }
    return best;
  }

  /** resetSession / pause: no tracks, auto; 全部套用 is not ours to touch */
  reset(): void {
    this.list = [];
    this.sel = 'auto';
    this.autoId = null;
    this.challenger = null;
    this.noAnswerSince = null;
    this.any.reset(0);
  }
}

export type TapAction = { kind: 'collapse' } | { kind: 'select'; id: TrackId; allOff: boolean };

/** S §2.5: what a camera tap does */
export function cameraTapAction(hit: TrackId | null, shownTracks: number, selection: CameraSelection, allOn: boolean): TapAction {
  if (shownTracks < 2) return { kind: 'collapse' };
  if (allOn && hit !== null) return { kind: 'select', id: hit, allOff: true };
  if (hit !== null && selection !== hit) return { kind: 'select', id: hit, allOff: false };
  return { kind: 'collapse' };
}

/** C1: a client point on the cover-fitted canvas → unmirrored video UV, and 44 pt in UV at that scale */
export function coverTapUv(
  x: number,
  y: number,
  rect: { left: number; top: number; width: number; height: number },
  vw: number,
  vh: number,
  mirrored: boolean,
): { u: number; v: number; minW: number; minH: number } {
  const s = Math.max(rect.width / vw, rect.height / vh);
  let u = (x - rect.left - (rect.width - vw * s) / 2) / (vw * s);
  const v = (y - rect.top - (rect.height - vh * s) / 2) / (vh * s);
  if (mirrored) u = 1 - u;
  return { u, v, minW: 44 / (s * vw), minH: 44 / (s * vh) };
}

/** the inverse: unmirrored video UV → px inside the canvas rect (the face marker) */
export function videoToFrame(u: number, v: number, rect: { width: number; height: number }, vw: number, vh: number, mirrored: boolean): [number, number] {
  const s = Math.max(rect.width / vw, rect.height / vh);
  const uu = mirrored ? 1 - u : u;
  return [(rect.width - vw * s) / 2 + uu * vw * s, (rect.height - vh * s) / 2 + v * vh * s];
}

/** The 全部套用 chip (S §2.5): shows once ≥ 2 shown tracks lasted 300 ms, hides after < 2 for 1200 ms, never while on. */
export class ChipGate {
  private visible = false;
  private since: number | null = null;

  update(shownTracks: number, allOn: boolean, nowMs: number): boolean {
    if (allOn) {
      this.visible = true;
      this.since = null;
      return true;
    }
    const want = shownTracks >= 2;
    if (want === this.visible) {
      this.since = null;
      return this.visible;
    }
    this.since ??= nowMs;
    if (nowMs - this.since >= (want ? 300 : 1200)) {
      this.visible = want;
      this.since = null;
    }
    return this.visible;
  }
}
```

Note the gate as written resets `since` whenever the count agrees with the current state, so a flicker never accumulates 300 / 1200 ms (the tests' alternating streams).

- [ ] **Step 4: `shotSeed` (`src/ui/imaging.ts`, append; `FaceSeed` type import)**

```ts
/**
 * The camera's seed in the saved photo (S §3.4 C2): video UV → the centre crop, then mirrored when the shot is saved
 * mirrored. Not clamped: a seed outside the crop must not match an edge face.
 */
export function shotSeed(seed: { x: number; y: number } | 'all' | null, vw: number, vh: number, ratio: number, mirrored: boolean): FaceSeed {
  if (seed === null || seed === 'all') return seed;
  const r = centerCropRect(vw, vh, ratio);
  const x = (seed.x * vw - r.x) / r.width;
  const y = (seed.y * vh - r.y) / r.height;
  return { x: mirrored ? 1 - x : x, y };
}
```

- [ ] **Step 5: Run and commit**

Run: `npx vitest run src/app src/ui/ui.test.ts && npm run typecheck`
Expected: PASS.

```bash
git add src/app/oneEuro.ts src/app/oneEuro.test.ts src/app/faceTracks.ts src/app/faceTracks.test.ts src/ui/imaging.ts src/ui/ui.test.ts
git commit -m "v0.4 step 1e: One-Euro smoother, face tracks, tap table, chip gate and the seed mapping"
```

---

### Task 25: The camera on tracks — taps, 全部套用, the marker, the hand-over (sub-step 1e gate)

**Files:**
- Modify: `src/config/limits.ts` (`LIVE_DETECT_FACES`), `src/tracking/tracker.test.ts` (port), `src/app/live.ts` (CRLF), `src/app/live.test.ts` (CRLF), `src/ui/state.ts` (CRLF: `Shot`, `AppState.cameraAll`), `src/ui/screens/Camera.tsx` (CRLF), `src/ui/screens/Review.tsx` (CRLF), `src/ui/theme.css` (CRLF), `src/bench/main.ts` (CRLF, `:326-336, :394`), `tests/harness/t7/fakes.ts` (`fakeLiveLoop`), `playwright.config.ts`, `src/bench/multiFace.ts` (rows L, J, J2), `scripts/bench-multiface.mjs` (`--video`)
- Create: `src/ui/components/CameraFaceMarker.tsx`, `tests/e2e/camera-group.spec.ts`

**Interfaces:**
- Consumes: Task 24 (`FaceTracks`, `cameraTapAction`, `coverTapUv`, `videoToFrame`, `ChipGate`, `shotSeed`), `cameraShotEdit` (Task 9), `freshSource` (Task 12), `StillFrame` (Task 18).
- Produces:

```ts
// src/app/live.ts
export interface LiveStats { fps; detectMs; renderMs; tier; face: boolean; /** shown tracks, held ones included */ faces: number }
export interface LiveLoop {
  stop(): void;
  setCompare(on: boolean): void;
  capture(): { image: ImageData; seed: { x: number; y: number } | 'all' | null } | null;
  hitTest(u: number, v: number, minW: number, minH: number): TrackId | null;
  select(id: TrackId): void;
  selection(): CameraSelection;
  tracks(): LiveTrackView[];
}
export interface LiveDeps { camera; engine; tracker; getLook: () => CameraLook; getAll: () => boolean; getPrefs; onStats? }
export function liveFrame(views: readonly LiveTrackView[], anyFace: number, look: CameraLook): StillFrame;
// src/ui/state.ts
Shot.faceSeed: FaceSeed;  AppState.cameraAll: boolean   // in memory, false at start, never persisted
// src/ui/components/CameraFaceMarker.tsx
export function CameraFaceMarker(p: { loop: LiveLoop; canvas: HTMLCanvasElement; video: HTMLVideoElement; mirrored: boolean; ring: { id: TrackId; at: number } | null; all: boolean; count: number }): JSX.Element;
```

- [ ] **Step 1: Turn multi-face tracking on, and port the tracker test**

`src/config/limits.ts`: `export const LIVE_DETECT_FACES = MAX_LIVE_FACES;` and its comment becomes `/** numFaces the camera requests: every live instance is built with it and the camera never toggles it (T1) */`.

`src/tracking/tracker.test.ts` (mechanical, behaviour unchanged): import `LIVE_DETECT_FACES` from `../config/limits`; `const ONE = { maxFaces: 1 };` → `const ONE = { maxFaces: LIVE_DETECT_FACES };`; every `numFaces: 1 }` inside a `setOptions` expectation of the ported v0.3 tests (`:146, :272, :289, :291`) → `numFaces: LIVE_DETECT_FACES }`; in the Task 13 test `expect(lm.opts.numFaces).toBe(1); // the first instance: LIVE_DETECT_FACES` → `toBe(LIVE_DETECT_FACES)`.

Run: `npx vitest run src/tracking/tracker.test.ts src/config`
Expected: PASS.

- [ ] **Step 2: Port the live tests and add the multi-face cases (they fail until Step 3)**

`src/app/live.test.ts` (CRLF):
1. The adapter mock places the fake faces apart, so two detections are two tracks: `adapt: vi.fn((lm: { points: Float32Array }) => makeFace(++faceSeq, lm.points[0] > 0.5005 ? 0.75 : 0.25)),` (`makeLandmarks(tag)` puts `0.5 + tag/1000` in `points[0]`).
2. `setup(opts)` (`:24-56`): `opts` gains `faces?: number`; `fakeTracker(clock)` → `fakeTracker(clock, true, opts.faces ?? 1)`; the deps' `getParams: () => params,` → `getLook: () => splitLegacy(params), getAll: () => all,` with `let all = false;` declared at the top of `setup`, and the returned object gains `setAll(on: boolean) { all = on; },` (import `splitLegacy` from `../edit/legacy`). Every other `LiveDeps` literal in the file (the test at `:110-125` builds its own with `getParams: () => p`) gets the same port: `getParams: () => X` → `getLook: () => splitLegacy(X), getAll: () => false`.
3. `loop.capture()` results: `const img = loop.capture()` → `const img = loop.capture()?.image ?? null` (`expect(loop.capture()).toBeNull()` stays).
4. The render-input assertions keep the Task 18 helpers (`faceOf`, `weightOf`); the capture test's `toMatchObject({ … params })` → `expect(input.photo).toEqual(splitLegacy(params).photo)`.

Append:

```ts
describe('live loop on face tracks (S §3.3 Live camera, §3.4 T4)', () => {
  it('lists every shown track: the auto face at weight 1, the other at 0 (caps only); 全部套用 beautifies both', () => {
    const { engine, loop, setAll } = setup({ faces: 2 });
    vi.advanceTimersByTime(600);
    const input = engine.lastInput()!;
    expect(input.faces.map((f) => f.weight).sort()).toEqual([0, 1]);
    expect(input.globalSkin?.weight).toBe(0);
    setAll(true);
    vi.advanceTimersByTime(300);
    expect(engine.lastInput()!.faces.map((f) => f.weight)).toEqual([1, 1]);
    loop.stop();
  });
  it('select pins a track; capture returns the beautified raw box centre, or all', () => {
    const { loop, setAll } = setup({ faces: 2 });
    vi.advanceTimersByTime(600);
    const right = loop.tracks().find((t) => t.box.x > 0.5)!;
    expect(loop.hitTest(right.box.x + right.box.w / 2, 0.5, 0.01, 0.01)).toBe(right.id);
    loop.select(right.id);
    expect(loop.selection()).toBe(right.id);
    vi.advanceTimersByTime(300);
    expect(loop.capture()!.seed).toEqual({ x: right.rawBox.x + right.rawBox.w / 2, y: right.rawBox.y + right.rawBox.h / 2 });
    setAll(true);
    expect(loop.capture()!.seed).toBe('all');
    loop.stop();
  });
  it('LiveStats.faces counts the shown tracks', () => {
    const { stats, loop } = setup({ faces: 2 });
    vi.advanceTimersByTime(600);
    expect(stats.at(-1)!.faces).toBe(2);
    loop.stop();
  });
});
```

Run: `npx vitest run src/app/live.test.ts`
Expected: FAIL (`getLook` unknown, `tracks` missing).

- [ ] **Step 3: The live loop (`src/app/live.ts`, CRLF)**

1. Imports: drop `adapt` and `Face`; add `LIVE_DETECT_FACES, MAX_RENDER_FACES` (`../config/limits`), `FaceTracks, type CameraSelection, type LiveTrackView, type TrackId` (`./faceTracks`); types `CameraLook, FaceSeed, Landmarks478, StillFrame`; drop `legacyFrame` (Task 18).
2. `LiveStats` gains `faces: number`; `LiveLoop` and `LiveDeps` as in the Interfaces block (`getParams` → `getLook`, `getAll` added).
3. Add, above `startLiveLoop`:

```ts
/**
 * The camera's render input (S §3.3 Live camera item 3): every shown track with its eased weight and the one look; a
 * held track that faded out and lost its presence is dropped from the list (it bounds nobody's cap any more). The global
 * skin fades with "no face" exactly as v0.3 (A2): with one face this is legacyFrame(params, shown, weight).
 */
export function liveFrame(views: readonly LiveTrackView[], anyFace: number, look: CameraLook): StillFrame {
  const p = look.person.values;
  return {
    faces: views
      .filter((v) => v.weight > 0 || v.presence > 0)
      .slice(0, MAX_RENDER_FACES)
      .map((v) => ({ face: v.face, weight: v.weight, person: look.person, protect: null, presence: v.presence })),
    obstacles: [],
    globalSkin: { smooth: p['skin.smooth'], rosy: p['skin.rosy'], weight: 1 - anyFace },
    photo: look.photo,
  };
}
```

4. In `startLiveLoop`: replace `const easer = new FaceWeightEaser();` with `const tracks = new FaceTracks();` (drop the `FaceWeightEaser` import if unused); delete `detected`, `shown`, `weight`.
5. `step()`: `const params = deps.getParams();` → `const look = deps.getLook();`, `ensureFilter(look.photo.filterId)`; the detection block becomes

```ts
    let detectMs: number | null = null;
    if (tracker && shouldDetect(engine.tier, detectedLastFrame)) {
      const t0 = performance.now();
      tracks.detect(detectFaces(tracker), now, w, h);
      detectMs = performance.now() - t0;
      detectedLastFrame = true;
    } else {
      detectedLastFrame = false;
    }
    tracks.step(interval ?? 0, deps.getAll(), now);
```

   and `draw(params, w, h)` → `draw(look, w, h)`.
6. Replace `detectFace` and `draw`:

```ts
  /** null = no answer (the throw is reported), so a hiccup never drops a track (A5) */
  function detectFaces(t: Tracker): Landmarks478[] | null {
    try {
      return t.detectVideo(video, performance.now(), { maxFaces: LIVE_DETECT_FACES });
    } catch (err) {
      reportError('live detect', err);
      return null;
    }
  }

  function draw(look: CameraLook, w: number, h: number): void {
    if (compare) engine.renderOriginal({ source: video, width: w, height: h });
    else engine.render({ source: video, width: w, height: h, ...liveFrame(tracks.views(), tracks.anyFace, look) });
  }
```

7. `resetSession` and `pause`: replace the `detected = null; shown = null; weight = 0; easer.reset(0);` lines with `tracks.reset();`.
8. `publish`: `face: tracks.views().some((v) => v.present),` and `faces: tracks.views().length,`; in the `dbg` block also `dbg.faces = s.faces; dbg.boxes = tracks.views().map((v) => ({ id: `t${v.id}`, ...v.box })); dbg.selected = deps.getAll() ? 'all' : (() => { const b = tracks.beautified(); return b ? `t${b.id}` : null; })();`; `changed` also compares `lastEmitted.faces !== s.faces`.
9. `redraw`: `draw(deps.getLook(), video.videoWidth, video.videoHeight)`.
10. The returned object:

```ts
    capture() {
      if (stopped || paused || !haveFrame || !isLive() || !hasVideoFrame()) return null;
      const prefs = deps.getPrefs();
      const image = engine.renderToImageData(
        { source: video, width: video.videoWidth, height: video.videoHeight, ...liveFrame(tracks.views(), tracks.anyFace, deps.getLook()) },
        { mirror: prefs.mirrorOnSave && camera.snapshot.facing === 'user' },
      );
      // the hand-over seed (C2): the beautified track's last RAW box centre (not the smoothed one), unmirrored video UV
      const views = tracks.views();
      const b = tracks.beautified();
      const seed: FaceSeed = !views.length ? null : deps.getAll() ? 'all' : b ? { x: b.rawBox.x + b.rawBox.w / 2, y: b.rawBox.y + b.rawBox.h / 2 } : null;
      return { image, seed: seed as { x: number; y: number } | 'all' | null };
    },
    hitTest: (u, v, minW, minH) => tracks.hitTest(u, v, minW, minH),
    select(id: TrackId) {
      tracks.select(id);
    },
    selection: (): CameraSelection => tracks.selection(),
    tracks: () => tracks.views(),
```

Run: `npx vitest run src/app && npm run typecheck`
Expected: the live tests PASS; `tsc` lists only the callers fixed in Step 4.

- [ ] **Step 4: Callers: state, Camera, Review, the bench page and the t7 fake**

`src/ui/state.ts` (CRLF): `Shot` gains `/** camera → editor (C2): the beautified face's centre in the saved image, 'all', or null */ faceSeed: FaceSeed;`; `AppState` gains `/** 全部套用 (S §2.5): in memory only, false at app start, kept across Review and retakes */ cameraAll: boolean;` with `cameraAll: false,` in the store init. Import the `FaceSeed` type.

`src/ui/components/CameraFaceMarker.tsx`:

```tsx
// The camera's face marker (S §2.5): an 800 ms accent ring after a selection and a 6 px dot above the beautified face
// while ≥ 2 tracks are shown and 全部套用 is off. DOM only, pointer-events: none; never part of the captured photo.
import { useEffect, useRef } from 'preact/hooks';
import type { LiveLoop } from '../../app/live';
import { type TrackId, videoToFrame } from '../../app/faceTracks';

export function CameraFaceMarker({ loop, canvas, video, mirrored, ring, all, count }: { loop: LiveLoop; canvas: HTMLCanvasElement; video: HTMLVideoElement; mirrored: boolean; ring: { id: TrackId; at: number } | null; all: boolean; count: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = 0;
      const el = ref.current;
      if (!el) return;
      const views = loop.tracks();
      const ringOn = ring !== null && performance.now() - ring.at < 800;
      const dotOn = views.length >= 2 && !all;
      el.replaceChildren();
      if (!ringOn && !dotOn) return; // nothing to draw: the loop stops until a prop changes
      const rect = canvas.getBoundingClientRect();
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      for (const v of views) {
        const showRing = ringOn && v.id === ring!.id;
        const showDot = dotOn && v.beautified;
        if (!showRing && !showDot) continue;
        const [ax, ay] = videoToFrame(v.box.x, v.box.y, rect, vw, vh, mirrored);
        const [bx, by] = videoToFrame(v.box.x + v.box.w, v.box.y + v.box.h, rect, vw, vh, mirrored);
        const left = Math.min(ax, bx);
        const width = Math.abs(bx - ax);
        if (showRing) {
          const r = document.createElement('i');
          r.className = 'cam-ring';
          Object.assign(r.style, { left: `${left}px`, top: `${ay}px`, width: `${width}px`, height: `${by - ay}px` });
          el.append(r);
        }
        if (showDot) {
          const d = document.createElement('i');
          d.className = 'cam-dot';
          Object.assign(d.style, { left: `${left + width / 2 - 3}px`, top: `${ay - 12}px` });
          el.append(d);
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [loop, ring, all, mirrored, count]);
  return <div class="cam-marker" ref={ref} aria-hidden="true" />;
}
```

`src/ui/screens/Camera.tsx` (CRLF):
1. Imports: `CameraFaceMarker` (`../components/CameraFaceMarker`); `cameraTapAction, ChipGate, coverTapUv, type TrackId` (`../../app/faceTracks`); `shotSeed` with `cropImageData, grabOriginalFrame` (`../imaging`).
2. State: `const cameraAll = useStore(app, (s) => s.cameraAll);`, `const [chip, setChip] = useState(false);`, `const chipGate = useRef(new ChipGate());`, `const [ring, setRing] = useState<{ id: TrackId; at: number } | null>(null);`, `const [shownFaces, setShownFaces] = useState(0);`.
3. `onStats` (`:104-112`) becomes:

```tsx
    const onStats = (s: LiveStats) => {
      setShownFaces(s.faces);
      setChip(chipGate.current.update(s.faces, app.get().cameraAll, performance.now()));
      if (s.face === lastFace) return;
      lastFace = s.face;
      clearTimeout(faceTimer);
      // debounce so blinks / brief misses don't flash the badge
      if (s.face) setNoFace(false);
      else faceTimer = window.setTimeout(() => setNoFace(true), 1200);
    };
```

4. `startLiveLoop` deps: `getParams: …` → `getLook: () => lookRef.current, getAll: () => app.get().cameraAll,`.
5. `captureFrom`: `let shotOut: ReturnType<LiveLoop['capture']>; try { shotOut = l.capture(); } …; if (!shotOut) { toast('還沒有取得畫面，請稍候'); return; }`; `const img = shotOut.image;`; rename the ratio local to `ratioValue`; after `const mirror = …` add `const faceSeed = shotSeed(shotOut.seed, cam.video.videoWidth, cam.video.videoHeight, ratioValue, mirror);`; the shot becomes `{ image, file, original, look: lookRef.current, faceSeed }`.
6. `onStageClick`:

```tsx
  const onStageClick = (e: MouseEvent) => {
    if ((e.target as Element).closest('.slider-row, .status, button')) return;
    if (!live) return;
    const l = loopRef.current;
    const canvas = bundle?.engine.canvas;
    const shown = l?.tracks().length ?? 0;
    let hit: TrackId | null = null;
    if (l && canvas && ctrl && shown >= 2) {
      const m = coverTapUv(e.clientX, e.clientY, canvas.getBoundingClientRect(), ctrl.video.videoWidth, ctrl.video.videoHeight, snap?.facing === 'user');
      hit = l.hitTest(m.u, m.v, m.minW, m.minH);
    }
    const a = cameraTapAction(hit, shown, l?.selection() ?? 'auto', app.get().cameraAll);
    if (a.kind === 'collapse') {
      setCollapsed((c) => !c);
      return;
    }
    haptic();
    if (a.allOff) app.set({ cameraAll: false });
    l!.select(a.id);
    setRing({ id: a.id, at: performance.now() });
  };
```

7. Inside `.frame`, after `<CanvasHost fit="cover" />`:

```tsx
          {ready && loop && bundle && ctrl && !hold.held && (
            <CameraFaceMarker loop={loop} canvas={bundle.engine.canvas} video={ctrl.video} mirrored={snap?.facing === 'user'} ring={ring} all={cameraAll} count={shownFaces} />
          )}
          {ready && (chip || cameraAll) && !hold.held && (
            <button
              type="button"
              class={`float-btn all-chip${cameraAll ? ' on' : ''}`}
              aria-pressed={cameraAll}
              onClick={(e) => {
                e.stopPropagation();
                haptic();
                app.set({ cameraAll: !cameraAll });
              }}
            >
              <span>全部套用</span>
            </button>
          )}
```

`src/ui/screens/Review.tsx` (CRLF) `edit()`: `source: freshSource(shot.original, cameraShotEdit(shot.look, shot.faceSeed), 'camera', shot.faceSeed)`.

`src/ui/theme.css` (CRLF), append, then run the Task 22 CRLF normalizer on it and on `Camera.tsx`, `Review.tsx`, `state.ts`, `live.ts`, `live.test.ts`, `bench/main.ts`:

```css
.all-chip {
  position: absolute;
  left: 8px;
  top: 8px;
  height: 32px;
  z-index: 3;
}
/* the pill is the float button's span (.float-btn > span, theme.css:1645); on = accent fill, as .float-btn.held > span */
.all-chip.on > span {
  background: var(--accent);
  color: var(--accent-ink);
}
.cam-marker {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.cam-ring {
  position: absolute;
  border: 2px solid var(--accent);
  border-radius: 50%;
  animation: cam-ring 800ms ease-out forwards;
}
.cam-dot {
  position: absolute;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
}
@keyframes cam-ring {
  from { transform: scale(1.15); opacity: 1; }
  to { transform: scale(1); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .cam-ring { animation: none; }
}
```

`src/bench/main.ts` (CRLF): `getParams: () => params,` → `getLook: () => splitLegacy(params), getAll: () => false,` (import `splitLegacy` from `../edit/legacy`); `captureTest`: `const img = loop.capture()?.image ?? null;`.

`tests/harness/t7/fakes.ts` `fakeLiveLoop`: the two render inputs use `...fakeFrame(d.getLook())` with

```ts
const fakeFrame = (look: CameraLook) => ({
  faces: [],
  obstacles: [],
  globalSkin: { smooth: look.person.values['skin.smooth'], rosy: look.person.values['skin.rosy'], weight: 1 },
  photo: look.photo,
});
```

the stats object gains `faces: flag('face') !== '0' ? 1 : 0`, `capture` returns `{ image: e.renderToImageData(…), seed: null }` (null when there is no frame, as now), and the returned loop adds `hitTest: () => null, select: () => undefined, selection: () => 'auto' as const, tracks: () => [],`.

Run: `npm run typecheck && npx vitest run`
Expected: PASS.

- [ ] **Step 5: The group camera e2e project and spec**

`playwright.config.ts`: after `const y4m = …` add `const groupY4m = resolve(import.meta.dirname, 'tests/fixtures/group.y4m');`; the `chromium` project gains `testIgnore: 'camera-group.spec.ts',`; add a second project:

```ts
    {
      name: 'chromium-group',
      testMatch: 'camera-group.spec.ts',
      use: {
        browserName: 'chromium',
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            `--use-file-for-fake-video-capture=${groupY4m}`,
            '--enable-unsafe-swiftshader',
          ],
        },
      },
    },
```

`tests/e2e/camera-group.spec.ts`:

```ts
// The camera with three faces (S §8.4): group.y4m shows A, B and C (gen-y4m from group_faces.png), inside the 3:4
// preview: A above, B and C side by side below it (composeGroupCam).
import type { Page } from '@playwright/test';
import { debugState, expect, grab, hold, regionDiff, test } from './fixtures';

/** a camera debug box (unmirrored video UV) → client px and → a rect in fractions of the preview frame */
async function camGeom(page: Page, id: string) {
  const b = (await debugState(page)).boxes.find((x) => x.id === id)!;
  return page.evaluate((b) => {
    const c = document.querySelector('.cam-stage canvas') as HTMLCanvasElement;
    const v = document.querySelector('video') as HTMLVideoElement;
    const r = c.getBoundingClientRect();
    const s = Math.max(r.width / v.videoWidth, r.height / v.videoHeight);
    const fx = (u: number) => (r.width - v.videoWidth * s) / 2 + (1 - u) * v.videoWidth * s; // the front camera preview is mirrored
    const fy = (y: number) => (r.height - v.videoHeight * s) / 2 + y * v.videoHeight * s;
    const x0 = fx(b.x + b.w);
    const x1 = fx(b.x);
    return {
      point: { x: r.left + (x0 + x1) / 2, y: r.top + fy(b.y + b.h / 2) },
      rect: { x: x0 / r.width, y: fy(b.y) / r.height, w: (x1 - x0) / r.width, h: (fy(b.y + b.h) - fy(b.y)) / r.height },
    };
  }, b);
}
const byX = async (page: Page) => [...(await debugState(page)).boxes].sort((a, b) => b.x - a.x).map((b) => b.id); // mirrored: screen left → right

test('three faces: auto beautifies the largest; tap B; 全部套用; tap C; the hand-over selects B', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /拍攝/ }).click();
  await page.getByRole('button', { name: '點擊開啟相機' }).click();
  await expect.poll(async () => (await debugState(page)).faces, { timeout: 120_000, intervals: [500] }).toBe(3);
  // a photo-level look of zero, so an unselected face is untouched pixel for pixel
  await page.getByRole('tab', { name: '美膚' }).click();
  for (const item of ['美白', '銳化']) {
    await page.getByRole('option', { name: item, exact: true }).click();
    const s = page.getByRole('slider');
    await s.focus();
    for (let i = 0; i < 100; i++) await page.keyboard.press('ArrowLeft');
  }
  const boxes = (await debugState(page)).boxes;
  const largest = [...boxes].sort((a, b) => b.w * b.h - a.w * a.h)[0].id;
  expect((await debugState(page)).selected).toBe(largest);
  const [B, C] = (await byX(page)).reverse().filter((id) => id !== largest); // A is the largest; B, C left to right in the scene
  const frame = page.locator('.cam-stage .frame');
  await page.addStyleTag({ content: '.cam-marker, .all-chip, .badge { display: none !important; }' });
  // tap B: B beautified, A unchanged
  const gb = await camGeom(page, B);
  await page.mouse.click(gb.point.x, gb.point.y);
  await expect.poll(async () => (await debugState(page)).selected).toBe(B);
  await page.waitForTimeout(500);
  const beautified = await grab(frame);
  const release = await hold(page, page.locator('.cam-controls .side-btn', { hasText: '按住對比' }));
  await page.waitForTimeout(400);
  const original = await grab(frame);
  await release();
  const ga = await camGeom(page, largest === B ? C : largest);
  expect(regionDiff(original, beautified, gb.rect).inside).toBeGreaterThan(0.5);
  expect(regionDiff(original, beautified, ga.rect).inside).toBeLessThan(0.3);
  // 全部套用: every face changes; a tap on C turns it off and selects C
  await page.addStyleTag({ content: '.all-chip { display: inline-flex !important; }' });
  const chip = page.getByRole('button', { name: '全部套用' });
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await debugState(page)).selected).toBe('all');
  const gc = await camGeom(page, C);
  await page.mouse.click(gc.point.x, gc.point.y);
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await debugState(page)).selected).toBe(C);
  // hand-over: B selected, shutter → 編輯 → the editor selects the person whose face holds the seed (B)
  const gb2 = await camGeom(page, B);
  await page.mouse.click(gb2.point.x, gb2.point.y);
  await expect.poll(async () => (await debugState(page)).selected).toBe(B);
  await page.getByRole('button', { name: '拍照' }).click();
  await page.getByRole('button', { name: '編輯' }).click();
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 90_000 });
  await expect.poll(async () => (await debugState(page)).faces, { timeout: 60_000 }).toBeGreaterThanOrEqual(1);
  const d = await debugState(page);
  // the shot is the preview's 3:4 crop, mirrored as the preview (mirrorOnSave), so B's face is where gb2.rect was
  const bx = gb2.rect.x + gb2.rect.w / 2;
  const by = gb2.rect.y + gb2.rect.h / 2;
  const dist = (b: { x: number; y: number; w: number; h: number }) => Math.hypot(b.x + b.w / 2 - bx, b.y + b.h / 2 - by);
  const atB = [...d.boxes].sort((a, b) => dist(a) - dist(b))[0].id;
  expect(d.selected).toBe(atB);
});
```

**Clip layout (Task 1 review fix):** the preview shows only the centred 3:4 window of the 1280 × 720 clip (x 0.289–0.711), so a fit of the whole of `group_faces.png` (A, B and C at x 0.22 / 0.55 / 0.82) leaves A and C off screen. `group.y4m` (and `group_noise` / `group_pan`) is therefore composed by `gen-y4m.mjs`'s `composeGroupCam`: A, B and C cut out of `group_faces.png` at 1.2 × the width-fit size (A ≈ 222, B 180, C 169 px wide), A centred above at (640, 182) px, B at (505, 540) and C at (782, 540) below it (`GROUP_CAM`). So A is identified as the largest box (it is no longer the leftmost), B and C as the other two from scene left to right, and the hand-over checks the editor box at B's preview position: the centre-most box of the 3:4 shot is now A, not B.

(The chip shows only after 300 ms of ≥ 2 tracks; the style tag hiding it for the pixel grabs is overridden before it is clicked. The review screen's edit button is 「編輯」, `Review.tsx:119-123`.)

- [ ] **Step 6: Bench rows L, J, J2 and the driver's `--video`**

`src/bench/multiFace.ts`, append:

```ts
const r1 = (v: number) => Math.round(v * 10) / 10;

async function cameraVideo(): Promise<{ video: HTMLVideoElement; stop(): void }> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play();
  return { video, stop: () => stream.getTracks().forEach((t) => t.stop()) };
}

/** call `frame` on every video frame for `ms`; resolves with the frame rate */
function eachFrame(video: HTMLVideoElement, ms: number, frame: (now: number) => void): Promise<number> {
  return new Promise((done) => {
    const t0 = performance.now();
    let n = 0;
    const tick = (now: number) => {
      frame(now);
      n++;
      if (now - t0 < ms) video.requestVideoFrameCallback(tick);
      else done(n / ((now - t0) / 1000));
    };
    video.requestVideoFrameCallback(tick);
  });
}

async function liveTracker(): Promise<Tracker> {
  const { createTracker } = await import('../tracking/tracker');
  const { modelBuffer } = await loadEngineAssets();
  return createTracker({ modelBuffer, wasmBase: ENGINE_PATHS.wasmBase, delegate: 'auto' });
}

/** L: detectVideo at numFaces 1 and 3 on the camera for 10 s each (phone: point it at group_faces.png; desktop: --video group.y4m) */
export async function rowL(): Promise<MultiRow[]> {
  const cam = await cameraVideo();
  const out: MultiRow[] = [];
  try {
    for (const n of [1, 3]) {
      const t = await liveTracker();
      const times: number[] = [];
      let faces = 0;
      const fps = await eachFrame(cam.video, 10_000, (now) => {
        const t0 = performance.now();
        const r = t.detectVideo(cam.video, now, { maxFaces: n });
        times.push(performance.now() - t0);
        faces = Math.max(faces, r?.length ?? 0);
      });
      t.close();
      times.sort((a, b) => a - b);
      out.push({ row: 'L', config: `numFaces ${n}`, values: { p50_ms: r1(times[times.length >> 1]), p95_ms: r1(times[Math.floor(times.length * 0.95)]), fps: r1(fps), faces } });
    }
  } finally {
    cam.stop();
  }
  return out;
}

/** the largest face's pts111 centroid and points (px) of a detection */
function largestFace(lms: readonly Landmarks478[] | null, w: number, h: number): Float32Array | null {
  if (!lms?.length) return null;
  const faces = lms.map((l) => adapt(l, w, h));
  const best = faces.reduce((a, f) => (ovalBox(f).w * ovalBox(f).h > ovalBox(a).w * ovalBox(a).h ? f : a));
  return best.pts111;
}

/**
 * J (jitter, static scene, 2 s) and J2 (lag, panning, 4 s): MediaPipe's own smoothing (VIDEO, numFaces 1), the raw
 * landmarks (VIDEO, numFaces 3) and the app's smoother on the raw ones, on the same frames. Jitter: RMS of every
 * pts111 point's deviation from its mean, px at a 1080-px frame height. Lag: the mean of (raw − smoothed) / raw velocity
 * of the pts111 centroid x, ms.
 */
async function jitterLag(ms: number): Promise<Record<string, { pts: Float32Array[]; t: number[] }>> {
  const cam = await cameraVideo();
  const mp = await liveTracker();
  const raw = await liveTracker();
  const smoother = new LandmarkSmoother();
  const runs: Record<string, { pts: Float32Array[]; t: number[] }> = { mediapipe: { pts: [], t: [] }, raw: { pts: [], t: [] }, app: { pts: [], t: [] } };
  try {
    const w = cam.video.videoWidth;
    const h = cam.video.videoHeight;
    await eachFrame(cam.video, ms, (now) => {
      const m = largestFace(mp.detectVideo(cam.video, now, { maxFaces: 1 }), w, h);
      const rl = raw.detectVideo(cam.video, now, { maxFaces: 3 });
      const r = largestFace(rl, w, h);
      if (!m || !r || !rl) return;
      const big = rl.reduce((a, l) => (ovalBox(adapt(l, w, h)).w > ovalBox(adapt(a, w, h)).w ? l : a));
      const a = adapt({ points: smoother.apply(big.points, w, h, now) }, w, h).pts111;
      for (const [k, p] of [['mediapipe', m], ['raw', r], ['app', a]] as const) {
        runs[k].pts.push(p);
        runs[k].t.push(now);
      }
    });
  } finally {
    mp.close();
    raw.close();
    cam.stop();
  }
  return runs;
}

export async function rowJ(): Promise<MultiRow[]> {
  const runs = await jitterLag(2000);
  const h = 1080;
  return Object.entries(runs).map(([k, r]) => {
    const n = r.pts.length;
    let s = 0;
    let c = 0;
    for (let i = 0; i < 111; i++) {
      let mx = 0;
      let my = 0;
      for (const p of r.pts) {
        mx += p[i * 2] / n;
        my += p[i * 2 + 1] / n;
      }
      for (const p of r.pts) {
        s += ((p[i * 2] - mx) * h * (16 / 9)) ** 2 + ((p[i * 2 + 1] - my) * h) ** 2;
        c++;
      }
    }
    return { row: 'J', config: k, values: { rms_px1080: r1(Math.sqrt(s / Math.max(1, c))), frames: n } };
  });
}

export async function rowJ2(): Promise<MultiRow[]> {
  const runs = await jitterLag(4000);
  const cx = (p: Float32Array) => {
    let s = 0;
    for (let i = 0; i < 111; i++) s += p[i * 2];
    return s / 111;
  };
  const raw = runs.raw.pts.map(cx);
  const t = runs.raw.t;
  return (['mediapipe', 'app'] as const).map((k) => {
    const sm = runs[k].pts.map(cx);
    let sum = 0;
    let n = 0;
    for (let i = 3; i < raw.length; i++) {
      const v = (raw[i] - raw[i - 3]) / (t[i] - t[i - 3]); // UV per ms
      if (Math.abs(v) < 1e-5) continue;
      sum += (raw[i] - sm[i]) / v;
      n++;
    }
    return { row: 'J2', config: k, values: { lag_ms: n ? r1(sum / n) : 'n/a', samples: n } };
  });
}
addRunner('L', () => rowL());
addRunner('J', () => rowJ());
addRunner('J2', () => rowJ2());
```

(Imports at the top of `multiFace.ts`: `adapt` from `../tracking/adapter111`, `ovalBox` from `../engine/passes/faceCap`, `LandmarkSmoother` from `../app/oneEuro`, types `Landmarks478, Tracker`. The J/J2 "mediapipe" row is numFaces 1 with MediaPipe's own smoothing; PJ1 / PJ2 compare `app` against it, S §6.3.) Add `'L', 'J', 'J2'` to the buttons list.

`scripts/bench-multiface.mjs`: accept `--video <path>`: before `const ids = …` add

```js
const vi = process.argv.indexOf('--video');
const video = vi > 0 ? resolve(root, process.argv[vi + 1]) : null;
const args = process.argv.slice(2).filter((a, i, all) => a !== '--video' && all[i - 1] !== '--video');
```

use `args` in place of `process.argv.slice(2)` for `ids`, and pass, when `video` is set, `'--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`` in both `chromium.launch` `args` arrays.

Run on this desktop: `node scripts/bench-multiface.mjs --video tests/fixtures/group.y4m L`, `node scripts/bench-multiface.mjs --video tests/fixtures/group_noise.y4m J`, `node scripts/bench-multiface.mjs --video tests/fixtures/group_pan.y4m J2`, `node scripts/bench-multiface.mjs F BF PE M`.
Expected: Markdown blocks; L has two rows, J and J2 three and two. Append them to S §6.4 under the Task 3 results with the line `Decisions: none taken (desktop only; PL1/PL2/PJ1/PJ2/PB1/PBF/PF/PE1/PM1 need the iPhone rows, RM §12: the §3.5 defaults ship).`

- [ ] **Step 7: Sub-step 1e gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green.

Run: `npm run test:e2e`
Expected: both projects pass: `chromium` (every existing spec, `camera.spec.ts` with one face: a tap still collapses the panel, `:71-73`) and `chromium-group` (`camera-group.spec.ts`).

- [ ] **Step 8: Commit**

```bash
git add src tests playwright.config.ts scripts/bench-multiface.mjs docs/superpowers/specs/2026-10-12-face-person-select-design.md
git commit -m "v0.4 step 1e: camera face tracks, tap-to-select, 全部套用, the marker and the seed hand-over"
```

---

### Task 26: Step 1 gate

**Files:**
- None created or modified (a failing check sends you back to the task that owns it).

**Interfaces:**
- Consumes: everything above.
- Produces: a green step 1 on `feat/meiyan-pwa`, local commits only, version 0.3.0.

- [ ] **Step 1: The full suites**

Run: `npm run typecheck`
Expected: exit 0.

Run: `npm test`
Expected: every Vitest file passes (none skipped that passed at `892ea61`).

Run: `npm run build`
Expected: exit 0; `dist/` written.

Run: `npm run test:e2e`
Expected: every spec of both Playwright projects passes (`chromium`, `chromium-group`).

- [ ] **Step 2: v0.3 equivalence (RM §1.1, S §1.3)**

Run: `npx playwright test tests/e2e/parity.spec.ts --reporter=list`
Expected: PASS, with the logged per-golden max channel diff ≤ 1/255 and mean < 0.02/255.

Run: `npx vitest run src/engine/passes/reshapeCpu.test.ts -t "bit-exact" && npx vitest run src/body/field.test.ts -t "v0.3" && npx vitest run src/tracking/faceProtect.test.ts -t "byte-equal"`
Expected: PASS (one face bit-exact against `reshapeCpuV03.ts`; one person's 美體 field and 瘦臉 limit byte-equal to the v0.3 snapshots).

Run: `npx vitest run src/app/faceTracks.test.ts -t "live parity"`
Expected: PASS (one camera face eases exactly as v0.3).

- [ ] **Step 3: Only the intended assertion changes**

Run: `git diff 892ea61 --stat -- '*.test.ts' '*.test.tsx' 'tests/e2e/*.spec.ts'`
Then inspect `git diff 892ea61 -- <each pre-existing test file>` and confirm every changed **assertion** is one of S §8.5 (`bodyTracker.test.ts` `numPoses` 4 and `toDetections`; `panelModel.test.ts` the bands note; `reshapeCpu.test.ts` the hash pin; `camera.spec.ts` `meiyan.look.v1`) or a mechanical port named by a task (helpers `lensOf` / `proj` / `legacyFrame` / `faceOf` / `weightOf`, `face` → `faces`, `detectImage` arrays, `getParams` → `getLook`, `ONE` = `LIVE_DETECT_FACES`). Anything else: fix the code, not the test.

- [ ] **Step 4: Release hygiene**

Run: `node -p "require('./package.json').version"`
Expected: `0.3.0`.

Run: `git diff 892ea61 --numstat | awk '$1 > 100 && $1 == $2'`
Expected: no output. A pre-existing file whose every line changed is a line-ending rewrite: restore its endings with the Task 22 normalizer (CRLF files of the Global Constraints) and commit the fix locally.

Run: `git ls-files --eol src tests scripts | grep "w/crlf"`
Expected: every CRLF file of the Global Constraints is still listed; the files created by this plan are `w/lf`.

Run: `git status --short`
Expected: empty (everything committed; `tests/fixtures/*.y4m` and `tests/harness/b2/baseline/` are gitignored).

Run: `git log --oneline 1f0273d..HEAD`
Expected: the commits of Tasks 1–25 (plus the plan files, if they were committed), all local. **Do not push, do not deploy.**

- [ ] **Step 5: Record**

No commit (nothing changed). The step is done when Steps 1–4 hold; report the parity numbers and the §6.4 desktop rows in the step summary.

---
