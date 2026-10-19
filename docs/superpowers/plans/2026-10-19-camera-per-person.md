# Mona Misa 美顏 相機逐人美顏 (camera per-person beauty) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the live camera every face in view (down to 3 % of the stream's long edge on the back camera, 5 % in front-camera group scenes, up to 10) is tappable and keeps its own beauty settings through motion, swaps and short absences; the capture shows everyone as adjusted, and 編輯 continues each person's camera result.

**Architecture:** A pure session model (`LivePersons`, new) owns the persons, their params, the selection, 全部套用 and the away pool, and lives for one camera session (`src/ui/cameraSession.ts`). `FaceTracks` claims and releases persons with geometric identity only (velocity prediction, a size gate, re-identification gates). The live loop renders each track with its own person's params (untouched faces at weight 0, so a fresh camera is the composite pass alone), adds the group path (IMAGE detections on fixed views of the visible crop: the whole view and zoomed tiles) and a frame-rate-driven detection cadence. The shot carries a hand-over (photo look + each edited person's box and params) that the editor's first face answer maps onto its own faces (IoU, padded centre, a zoomed retry for small faces).

**Tech Stack:** TypeScript 5.9, Preact 10, Vite 8, the WebGL2 engine (N-face table), MediaPipe tasks-vision 0.10.35 (one FaceLandmarker), Vitest 5 (node), Playwright 1.63 (Chromium fake camera fed by y4m clips).

**Spec:** `docs/superpowers/specs/2026-10-19-camera-per-person-design.md` (cited as §n; K/U/A ids are its decisions). Contract documents: `2026-10-12-v04-roadmap.md` (RM) and `2026-10-12-face-person-select-design.md` (S). The spec's `file:line` anchors were taken at `4728133`; where they disagree with the code (e.g. `limits.ts:177/186` — `MAX_LIVE_FACES` is at `limits.ts:30`, `LIVE_DETECT_FACES` at `:39`, `MAX_RENDER_FACES` at `:20`), the cites in this plan are the current lines and win.

**Reconciliation (2026-10-19, before execution).** Checked against the tree at `1978218` (`4728133` plus this plan and its spec: no code changed since the plan was written; `npm test` 122 files, 2204 tests, green). Corrected in place:
- Base commit `1978218`, not `4728133` (Global Constraints).
- Anchors that were off: `CameraFaceMarker.test.tsx`'s `view` and `mount` are `:126-138` (was `:139-140`, Task 3); `original.spec.ts`'s camera test is `:156-249` and its stored-look poll `:200-202` (was `:158-249`, `:192-194`; Tasks 4, 11); `camera-group.spec.ts`'s first test is `:26-101` and its marker check `:31-44` (was `:25-108`, `:28-40`; Tasks 4, 9); `firstAnswer` runs to `migrate.ts:310` (Task 11); the camera-look describe of `settings.test.ts` is `:323-390` (Task 4).
- Task 4: `Camera.tsx` declares `ready`, `faceNote` and `faceOff` (`:317-320`) after `binding` (`:315`); `lensOf` and `keepDrag` read them now, so they move above it (a `const` read before its line throws).
- Task 5: `src/geometry/upFrame.test.ts:172, :202` build `Tracker` literals, and `tsconfig.json` type-checks tests, so they gain `detectView` and `warm` with the interface.
- Task 12: `camBox` is today's `camGeom` (`camera-group.spec.ts:7-23`) renamed; the `chromium` project's `testIgnore` is a RegExp, as `chromium-group`'s `testMatch` is.
- Tasks 12, 15, 16: `npm run build` before each targeted Playwright run (global setup refuses a missing `dist/`; a stale one tests old code).
- Commits: each Commit step stages the files it lists; the message is `v0.6 camera task <N>: <short title>` (fixes: `v0.6 camera task <N> fix: …`), a blank line, then the `Co-Authored-By` line, written to a new file and committed with `git commit -F`; this replaces the `-m` lines shown. Local only.
- Not a change: Task 8's e2e knob `meiyan.debug.live.v1` is §12.2's "test-only override" of `LIVE_GROUP`, a debug key like `meiyan.debug.export.v1`; §9's "no other key" is about settings and UI flags.

## Global Constraints

- Branch `feat/meiyan-pwa`, base `1978218` (the code of `4728133`); every commit is **local** (no push, no deploy). Version stays **0.5.0** until Task 17, which bumps it to 0.6.0 and writes the RM §15 release notes (K16, §13). The advance Codex review (U7), the clean-clone gate (project memory) and the push are the release step after Task 18, outside this plan.
- Windows Git Bash: pipe every git command through `| cat`. Use absolute paths or `cd /d/GitSource/MonaLisa &&`.
- **Line endings are preserved.** CRLF files touched here: `src/app/live.ts`, `src/app/testFakes.ts`, `src/types.ts`, `src/tracking/tracker.ts`, `src/ui/state.ts`, `src/ui/flows.ts`, `src/ui/deps.ts`, `src/ui/panelModel.ts`, `src/ui/theme.css`, `src/ui/screens/Camera.tsx`, `src/ui/screens/Review.tsx`, `src/ui/components/BeautyPanel.tsx`, `src/bench/main.ts`. Every other touched file is LF; new files are LF. Before each commit run the check below on the task's files; it must print `ok` for CRLF files and `lf` for LF files:
  `node -e "for (const f of process.argv.slice(1)) { const t = require('fs').readFileSync(f, 'utf8'); const crlf = (t.match(/\r\n/g) || []).length, lf = (t.match(/(?<!\r)\n/g) || []).length; console.log(f, crlf && lf ? 'MIXED ' + lf : crlf ? 'ok' : 'lf'); }" <files…>`
- One FaceLandmarker instance for everything (`tracker.ts:3-6`): modes, counts and bundles change only through `setOptions` on it; no second instance, no Worker (§2.2).
- On-device only; no new dependency (`package.json` dependencies stay `preact`, `@mediapipe/tasks-vision`).
- Fixtures come from repo-owned images only (`sample_face.png`, `group_faces.png`, `ten_faces.jpg`, all Apache-2.0, `LICENSES/NOTICE.txt`). **Never** the user's private photo or anything derived from it.
- Values copied verbatim from the spec: `MAX_LIVE_FACES = MAX_EDIT_FACES` (10), `LIVE_DETECT_FACES = MAX_LIVE_FACES`, `REID_GRACE_MS = 4000`, `REID_DIST = 1.5`, `REID_SIZE = 1.5`, `REID_AMBIGUITY = 1.25`, `TRACK_SIZE_JUMP = 1.5`, `LIVE_IDLE_MAX_MS = 60_000`, velocity EMA τ = 200 ms, `LIVE_MIN_FPS = 24`, `LIVE_MAX_DETECT_EVERY = 6`, cadence hysteresis 500 ms up / 1500 ms down, `LIVE_GROUP = true`, `LIVE_DETECTOR = { user: 'camera', environment: 'photo' }`, `LIVE_FACE_FLOOR = { user: 0.05, environment: 0.03 }`, `DETECTOR_FLOOR = { camera: 0.11, photo: 0.08 }`, large track at ≥ 1.25 × `DETECTOR_FLOOR` × crop long edge, `LIVE_SCAN_EVERY = 4`, `LIVE_SOLO_AFTER_MS = 5000`, `LIVE_VIEW_MAX_EDGE = 1280`, `HANDOVER_ZOOM_FACE = 0.25`, the group path's IMAGE calls at `EDIT_DETECT_FACES` (12).
- New copy, verbatim (§3.12): `點選畫面中的臉，可個別調整` (toast, 3.2 s, once per install, key `meiyan.hint.camPersons.v1`); `未偵測到臉部，對準人臉後即可調整` (panel note); `{label}，選取的人物` (slider aria); `{n} 位人物在照片中未偵測到臉部，未帶入相機效果` (editor toast, 3.2 s). Existing copy reused: `{label} · 整張照片`, `{label}，整張照片`, `{label}，全部`.
- Anti-goals hold in every task: A1 (the front-camera single-face selfie runs v0.5's solo path: VIDEO, short-range, a detection every frame), A2 (an ambiguous identity is always a new person at 原圖), A3 (nobody edited + neutral photo look → the composite pass alone).
- Unit tests run under Vitest's node environment (`vitest.config.ts`); DOM and `OffscreenCanvas` are stubbed in tests as the existing tests do (`tracker.test.ts:52-75`, `CameraFaceMarker.test.tsx`).
- Execution order: Tasks 3 and 4 change the camera's behaviour together. Between Task 3's commit and Task 4's, `tests/e2e/camera-group.spec.ts` and the camera test of `tests/e2e/original.spec.ts` are expected to fail (the panel still writes `look.person`, which the loop no longer reads); unit tests and typecheck stay green after every task. Run Task 4 right after Task 3. Likewise the camera test of `original.spec.ts` fails between Task 10 (a shot with a camera look now opens with it) and Task 11 (which rewrites that test). The camera test of `tests/e2e/adjust.spec.ts` (`:240-311` after the fix; `:239-310` at Task 10's commit), which expected the shot to open at 原圖 without the camera's 調節 and 質感, turns red at Task 10's commit too and is rewritten in Task 10's fix commit (changed on purpose, U6, §3.8), so it is not red after Task 10.

## Review Focus

1. **A flip or ✕ racing the stopping loop** (the old loop releases its tracks after the session ended): nobody on the new camera may inherit a person from the old one; expected: every release after `endCameraSession()` is dropped, and a stream on another facing clears the session anyway. Test: Task 3 (`live.test.ts`, "Review Focus #1").
2. **A ratio change while the group path runs** (the visible crop shrinks, the views are laid out again): a face now outside the crop must leave within `LOST_HOLD_MS`, never be held forever; faces still inside keep their persons. Test: Task 8 (`live.test.ts`, "Review Focus #2").
3. **A drag across a target change, or one the slider row drops without a commit** (the auto pick switches or the dragged person leaves mid-drag; the last face leaves and the person items turn off, or the camera pauses or flips mid-drag, so `SliderRow` resets without calling `onCommit`): while its slider is shown every write goes to the person the drag started on and no other person's values are copied into anyone; a dropped drag never carries into the next one, which starts on the current target. Tests: Task 4 (`cameraSession.test.ts`, the two "Review Focus #3" tests).
4. **A tracker that throws or cannot answer on the group path** (an IMAGE call throws; the instance is being replaced or the rebuild throttle holds, where `detectImage` would answer `[]` — "no face" — so the group path calls `detectView`, which answers null) with ≥ 2 faces: tracks, persons and the pinned selection are held (A5), the loop keeps drawing every frame, and detection resumes on the same persons. Tests: Task 5 (`tracker.test.ts`, `detectView`), Task 8 (`live.test.ts`, "Review Focus #4").
5. **A mirrored front-camera shot** with 左右分開 values and a person whose box falls outside the saved crop: boxes are mirrored, split sides swapped, and a person outside the picture is not handed over (no false 「未偵測到臉部」 toast). Test: Task 10 (`imaging.frame.test.ts`, "Review Focus #5").

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/config/limits.ts` | every new constant (one line each, doc comment citing the spec) | 1, 3, 6, 7, 11 |
| `src/edit/state.ts` | `isNeutralPerson`, `isNeutralPhoto`; `cameraEdit(photo, person)` | 1, 2 |
| `src/app/livePersons.ts` (new, pure) | the camera session: persons, params, selection, 全部套用, away pool, session clock, re-identification gates | 1 |
| `src/edit/lens.ts`, `src/ui/panelModel.ts` | the camera lens option: ≥ 2-faces labels and aria, ⊘ rule, no-face gate | 2 |
| `src/app/faceTracks.ts` | tracks claim/release persons; prediction, size gate, continuation, eviction; group-path scope | 3, 8 |
| `src/app/live.ts` | `LiveDeps.persons` / `getPhoto` / `group`; per-person `liveFrame`; release on pause/stop; capture `persons`; the solo and group paths; cadence; forced capture detection; stats and debug | 3, 8 |
| `src/ui/cameraSession.ts` (new) | the session singleton, `endCameraSession`, drag helpers | 3, 4 |
| `src/ui/screens/Camera.tsx` | lens over the target, writes through the session, 全部套用 copy, session end, warm-up, hint, hand-over | 3, 4, 8, 9, 10 |
| `src/ui/components/CameraFaceMarker.tsx`, `src/ui/theme.css` | brackets per face, dot on the target, dimming | 3, 9 |
| `src/store/settings.ts`, `src/ui/deps.ts` | K15 (`person` no longer read, written neutral); hint flag; live debug knob | 4, 8, 9 |
| `src/tracking/tracker.ts`, `src/types.ts`, `src/geometry/upFrame.ts`, `src/geometry/upFrame.test.ts`, `src/app/testFakes.ts`, `tests/harness/t7/fakes.ts` | `detectVideo` `detector`; `detectImage(OffscreenCanvas)`; `detectView` (the group path's IMAGE call with the live guards); `warm(mode, detector)`; `CameraHandOver`; debug fields | 3, 5, 8, 10 |
| `src/app/liveViews.ts` (new, pure) | §6.6 views of a crop, assignment, schedule, view → stream UV mapping, call scope | 6 |
| `src/app/liveCore.ts` | §6.4 cadence: `detectEvery`, `DetectCadence`, `effectiveEvery`, `cadenceSample` | 7 |
| `src/ui/imaging.ts`, `src/edit/sides.ts` | `shotBox`, `shotPersons`; `mirrorSides` restored | 10 |
| `src/edit/migrate.ts`, `src/detect/persons.ts`, `src/app/still.ts`, `src/ui/screens/Editor.tsx`, `src/ui/screens/Review.tsx`, `src/ui/state.ts`, `src/ui/flows.ts` | the hand-over: `handOverOf`, `handOverEdit`, `matchHandOver`, `firstAnswer` hand-over, the zoomed retry, the toast | 10, 11 |
| `scripts/gen-y4m.mjs`, `scripts/gen-group-fixture.mjs`, `tests/e2e/global-setup.ts`, `playwright.config.ts`, `LICENSES/NOTICE.txt` | upright clips, `group10.y4m`, `group_move.y4m`, their projects | 12 |
| `tests/e2e/camera-persons.spec.ts`, `camera-groups.spec.ts`, `camera-back.spec.ts`, `camera-identity.spec.ts` (new); `camera-group.spec.ts`, `camera.spec.ts`, `original.spec.ts`, `adjust.spec.ts`, `fixtures.ts` | E1–E5 and the specs changed on purpose | 4, 10, 11, 13, 14 |
| `src/bench/multiFace.ts`, `src/bench/report.ts`, `src/bench/main.ts`, `scripts/bench-multiface.mjs` | rows L (extended), LF, GS, WB, JG and their verdicts | 3, 15 |
| `docs/superpowers/specs/…` | measurements, gate outcomes, supersession pointers | 16 |
| `package.json`, `package-lock.json`, `src/ui/updateModel.test.ts`, `docs/superpowers/specs/2026-10-12-v04-roadmap.md` (§15) | 0.6.0 and its release notes (K16) | 17 |

---

### Task 1: The session model `LivePersons`

**Files:**
- Modify: `src/config/limits.ts` (append after `:47`), `src/config/limits.test.ts`
- Modify: `src/edit/state.ts` (add after `neutralPhoto`, `:81-83`), `src/edit/state.test.ts`
- Create: `src/app/livePersons.ts`, `src/app/livePersons.test.ts`

**Interfaces:**
- Consumes: `neutralPerson()` (`edit/state.ts:55`), `neutralPhoto()` (`:81`), `MAX_LIVE_FACES` (`limits.ts:30`; becomes 10 in Task 3), `Rect`, `Facing`, `PersonParams`, `PhotoParams` (`types.ts`).
- Produces:
  ```ts
  // limits.ts
  export const REID_GRACE_MS = 4000;
  export const REID_DIST = 1.5;
  export const REID_SIZE = 1.5;
  export const REID_AMBIGUITY = 1.25;
  export const TRACK_SIZE_JUMP = 1.5;
  export const LIVE_IDLE_MAX_MS = 60_000;
  // edit/state.ts
  export function isNeutralPerson(p: PersonParams): boolean; // every value at 原圖's (|Δ| < 1e-6) and 左右分開 off (`right === null`); shades and preset ignored
  export function isNeutralPhoto(p: PhotoParams): boolean;   // values at 原圖's, filterId 'none', look null, heightBand null; presetLink ignored
  // app/livePersons.ts
  export type LivePersonId = number;
  export function reidDistance(prev: Rect, next: Rect, aspect: number): number | null;
  export function nearestUnambiguous<T>(cands: readonly { item: T; d: number }[]): T | null;
  export interface TrackPersons {
    claim(box: Rect, aspect: number, now: number): LivePersonId;
    release(id: LivePersonId, box: Rect, now: number): void;
    sync(inView: readonly LivePersonId[], auto: LivePersonId | null): void;
    edited(id: LivePersonId): boolean;
    params(id: LivePersonId): PersonParams | null;
    target(): LivePersonId | null;
    all(): boolean;
  }
  export class LivePersons implements TrackPersons {
    get version(): number;
    get ambient(): PersonParams;
    setAmbient(p: PersonParams): void;
    params(id: LivePersonId): PersonParams | null;
    edited(id: LivePersonId): boolean;
    write(ids: readonly LivePersonId[], p: PersonParams): void;
    claim(box: Rect, aspect: number, now: number): LivePersonId;
    release(id: LivePersonId, box: Rect, now: number): void;
    sync(inView: readonly LivePersonId[], auto: LivePersonId | null): void;
    inView(): readonly LivePersonId[];
    selection(): 'auto' | LivePersonId;
    pin(id: LivePersonId): void;
    target(): LivePersonId | null;
    all(): boolean;
    setAll(on: boolean): void;
    editTargets(): LivePersonId[];
    panelParams(lead?: LivePersonId | null): PersonParams;
    edit(p: PersonParams, ids?: readonly LivePersonId[]): void;
    pause(now: number): void;
    resume(now: number, facing: Facing): void;
    clear(): void;
  }
  ```

- [x] **Step 1: Write the failing tests**

`src/edit/state.test.ts` (add; import `isNeutralPerson`, `isNeutralPhoto`, `emptyShades`, `defaultPhoto`, `naturalPerson`, `neutralPerson`, `neutralPhoto` from `./state`, `splitOn` from `./sides`, `LIP_SHADES` from `../engine/params`):

```ts
it('isNeutralPerson: values at 原圖 and 左右分開 off; shades and the preset never count. isNeutralPhoto: values, filter, 質感, band', () => {
  expect(isNeutralPerson(neutralPerson())).toBe(true);
  // a shade is never picked without a value (lens.setShade sets MAKEUP_PICK_DEFAULT), so a shade alone draws nothing
  expect(isNeutralPerson({ ...neutralPerson(), preset: 'custom', shades: { ...emptyShades(), lip: LIP_SHADES[0].id } })).toBe(true);
  expect(isNeutralPerson(naturalPerson())).toBe(false);
  expect(isNeutralPerson({ ...neutralPerson(), right: { 'shape.faceSlim': 0.3 } })).toBe(false);
  // 左右分開 switched on before any value moved: kept (else the session would write it back to null and the switch would not stick)
  expect(isNeutralPerson(splitOn(neutralPerson()))).toBe(false);
  expect(isNeutralPhoto(neutralPhoto())).toBe(true);
  expect(isNeutralPhoto({ ...neutralPhoto(), presetLink: null })).toBe(true);
  expect(isNeutralPhoto(defaultPhoto())).toBe(false);
  expect(isNeutralPhoto({ ...neutralPhoto(), filterId: 'warm' })).toBe(false);
  expect(isNeutralPhoto({ ...neutralPhoto(), look: { id: 'film', amount: 0.5 } })).toBe(false);
});
```

`src/config/limits.test.ts` (add): `expect([L.REID_GRACE_MS, L.REID_DIST, L.REID_SIZE, L.REID_AMBIGUITY, L.TRACK_SIZE_JUMP, L.LIVE_IDLE_MAX_MS]).toEqual([4000, 1.5, 1.5, 1.25, 1.5, 60_000]);`

`src/app/livePersons.test.ts` (new):

```ts
import { describe, expect, it } from 'vitest';
import { LIVE_IDLE_MAX_MS, MAX_LIVE_FACES } from '../config/limits';
import { naturalPerson, neutralPerson, personFromPreset } from '../edit/state';
import type { Rect } from '../types';
import { LivePersons } from './livePersons';

const ASPECT = 16 / 9;
/** a face box centred at (cx, 0.5), `w` wide (unmirrored video UV) */
const at = (cx: number, w = 0.1): Rect => ({ x: cx - w / 2, y: 0.35, w, h: 0.3 });
const natural = naturalPerson();
const refined = personFromPreset('refined', 1);
function session(): LivePersons {
  const s = new LivePersons();
  s.resume(0, 'user');
  return s;
}
/** a person seen at `cx`, edited, gone at `t` */
function away(s: LivePersons, cx: number, t: number, w = 0.1): number {
  const id = s.claim(at(cx, w), ASPECT, t);
  s.write([id], natural);
  s.release(id, at(cx, w), t);
  return id;
}

describe('LivePersons: claim and release (§7.4, K7)', () => {
  it('ids count up from 1; an unedited person who leaves is forgotten', () => {
    const s = session();
    expect(s.claim(at(0.3), ASPECT, 0)).toBe(1);
    expect(s.claim(at(0.6), ASPECT, 0)).toBe(2);
    s.release(1, at(0.3), 100);
    expect(s.claim(at(0.3), ASPECT, 200)).toBe(3);
    expect(s.params(3)).toBeNull();
  });
  it.each([
    ['3999 ms, 1.49 widths away, same size', 0.3 + 0.149, 0.1, 3999, true],
    ['4001 ms', 0.3, 0.1, 4001, false],
    ['1.51 widths away', 0.3 + 0.151, 0.1, 1000, false],
    ['×1.49 wider', 0.3, 0.149, 1000, true],
    ['×1.51 wider', 0.3, 0.151, 1000, false],
    ['×1.51 narrower', 0.3, 0.1 / 1.51, 1000, false],
  ])('re-identification gates: %s', (_, cx, w, t, same) => {
    const s = session();
    const id = away(s, 0.3, 0);
    const got = s.claim(at(cx, w), ASPECT, t);
    expect(got === id).toBe(same);
    expect(s.edited(got)).toBe(same);
  });
  it('two candidates about as near: 1.24 × the best → nobody (a new person at 原圖); 1.26 × → the nearer', () => {
    for (const [ratio, claimed] of [[1.24, false], [1.26, true]] as const) {
      const s = session();
      const a = away(s, 0.3, 0);
      away(s, 0.5, 0);
      const d = 0.2 / (1 + ratio); // a at d, the other at ratio × d
      const got = s.claim(at(0.3 + d), ASPECT, 1000);
      expect(got === a).toBe(claimed);
      expect(s.edited(got)).toBe(claimed);
    }
  });
  it(`the away pool holds MAX_LIVE_FACES persons, the oldest evicted`, () => {
    const s = session();
    const xs = Array.from({ length: MAX_LIVE_FACES + 1 }, (_, i) => 0.05 + i * 0.08);
    const ids = xs.map((x, i) => away(s, x, i * 10, 0.02));
    expect(s.claim(at(xs[0], 0.02), ASPECT, 500)).not.toBe(ids[0]);
    expect(s.claim(at(xs[1], 0.02), ASPECT, 500)).toBe(ids[1]);
  });
  it('a person written back to 原圖 (values neutral, preset custom) is never edited again (§3.3)', () => {
    const s = session();
    const id = s.claim(at(0.3), ASPECT, 0);
    s.write([id], natural);
    expect(s.edited(id)).toBe(true);
    s.write([id], { ...neutralPerson(), preset: 'custom' });
    expect([s.edited(id), s.params(id)]).toEqual([false, null]);
  });
});

describe('LivePersons: the session clock (§7.5, K8)', () => {
  it('pause / resume shifts the away pool by the paused span', () => {
    const s = session();
    const id = away(s, 0.3, 0);
    s.pause(500);
    s.resume(30_500, 'user');
    expect(s.claim(at(0.3), ASPECT, 30_500 + 3400)).toBe(id); // 500 + 3400 ms of live time ≤ 4000
  });
  it('more than LIVE_IDLE_MAX_MS without a live frame forgets everyone away and the remembered selection', () => {
    const s = session();
    const id = away(s, 0.3, 0);
    const p = s.claim(at(0.7), ASPECT, 0);
    s.pin(p);
    s.release(p, at(0.7), 0);
    s.pause(0);
    s.resume(LIVE_IDLE_MAX_MS + 1, 'user');
    expect(s.claim(at(0.3), ASPECT, LIVE_IDLE_MAX_MS + 2)).not.toBe(id);
    expect(s.claim(at(0.7), ASPECT, LIVE_IDLE_MAX_MS + 2)).not.toBe(p);
    expect(s.selection()).toBe('auto');
  });
  it('another facing ends the session; releases after clear() are dropped until the next resume', () => {
    const s = session();
    away(s, 0.3, 0);
    s.resume(10, 'environment');
    const a = s.claim(at(0.3), ASPECT, 20);
    expect(s.edited(a)).toBe(false);
    s.write([a], natural);
    s.clear();
    s.release(a, at(0.3), 30); // the old loop stopping after ✕ or a flip
    s.resume(40, 'environment');
    const b = s.claim(at(0.3), ASPECT, 50);
    expect([b, s.edited(b)]).toEqual([1, false]);
  });
});

describe('LivePersons: selection (§7.6, K9) and 全部套用 (§3.4, K10)', () => {
  const three = () => {
    const s = session();
    for (const x of [0.2, 0.5, 0.8]) s.claim(at(x), ASPECT, 0);
    s.sync([1, 2, 3], 1);
    return s;
  };
  it('the auto target until the first edit pins it', () => {
    const s = three();
    expect([s.selection(), s.target()]).toEqual(['auto', 1]);
    s.edit(natural);
    expect([s.selection(), s.params(1)]).toEqual([1, natural]);
    s.sync([1, 2, 3], 2);
    expect(s.target()).toBe(1);
  });
  it('a pinned person who leaves hands the target to auto and gets it back when re-identified (returnTo)', () => {
    const s = three();
    s.pin(2);
    s.release(2, at(0.5), 100);
    s.sync([1, 3], 1);
    expect([s.selection(), s.target()]).toEqual(['auto', 1]);
    expect(s.claim(at(0.5), ASPECT, 1500)).toBe(2);
    s.sync([1, 2, 3], 1);
    expect([s.selection(), s.target()]).toEqual([2, 2]);
  });
  it.each(['a tap', 'an edit', 'the pool clearing'] as const)('%s cancels the return', (how) => {
    const s = three();
    s.pin(2);
    s.release(2, at(0.5), 100);
    s.sync([1, 3], 1);
    let t = 1500;
    if (how === 'a tap') s.pin(3);
    if (how === 'an edit') s.edit(natural); // pins the auto target, 1
    if (how === 'the pool clearing') {
      s.pause(100);
      s.resume((t = 100 + LIVE_IDLE_MAX_MS + 1), 'user');
    }
    const back = s.claim(at(0.5), ASPECT, t + 1);
    s.sync([1, back, 3], 1);
    expect(s.target()).not.toBe(back);
  });
  it("全部套用: on copies the target's params to everyone in view, a face entering gets them, edits write all, off reverts nobody", () => {
    const s = three();
    s.edit(natural); // pins 1
    s.setAll(true);
    expect([s.params(2), s.params(3)]).toEqual([natural, natural]);
    const d = s.claim(at(0.95, 0.04), ASPECT, 10);
    s.sync([1, 2, 3, d], 1);
    expect(s.params(d)).toEqual(natural);
    s.edit(refined);
    expect([1, 2, 3, d].map((i) => s.params(i))).toEqual([refined, refined, refined, refined]);
    s.setAll(false);
    expect([1, 2, 3, d].map((i) => s.params(i))).toEqual([refined, refined, refined, refined]);
    s.edit(natural);
    expect([1, 2, 3, d].map((i) => s.params(i))).toEqual([natural, refined, refined, refined]);
  });
  it('全部套用 on with an untouched target copies 原圖 to everyone in view', () => {
    const s = three();
    s.write([2], natural);
    s.setAll(true);
    expect([1, 2, 3].map((i) => s.edited(i))).toEqual([false, false, false]);
  });
  it('editTargets: 全部套用 → everyone in view; else the target; [] with no face shown', () => {
    const s = three();
    expect(s.editTargets()).toEqual([1]);
    s.setAll(true);
    expect(s.editTargets()).toEqual([1, 2, 3]);
    s.setAll(false);
    s.sync([], null);
    expect(s.editTargets()).toEqual([]);
  });
  it('panelParams: the shared params under 全部套用, else the lead (or the target), 原圖 when untouched', () => {
    const s = three();
    s.write([2], natural);
    expect(s.panelParams()).toEqual(neutralPerson());
    expect(s.panelParams(2)).toEqual(natural);
    s.pin(2);
    s.setAll(true);
    s.edit(refined);
    expect(s.panelParams(1)).toEqual(refined);
  });
  it('clear() forgets everyone, the selection, 全部套用 and the ambient person; ids start again at 1', () => {
    const s = three();
    s.edit(natural);
    s.setAll(true);
    s.setAmbient(natural);
    s.clear();
    s.resume(0, 'user');
    expect([s.all(), s.selection(), s.target(), s.ambient]).toEqual([false, 'auto', null, neutralPerson()]);
    expect(s.claim(at(0.2), ASPECT, 0)).toBe(1);
  });
  it('version moves on every change and not on a sync that changes nothing', () => {
    const s = three();
    const v = s.version;
    s.sync([1, 2, 3], 1);
    expect(s.version).toBe(v);
    s.sync([1, 2, 3], 2);
    expect(s.version).toBeGreaterThan(v);
    const w = s.version;
    s.edit(natural);
    expect(s.version).toBeGreaterThan(w);
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `cd /d/GitSource/MonaLisa && npx vitest run src/app/livePersons.test.ts src/edit/state.test.ts src/config/limits.test.ts`
Expected: FAIL — `Cannot find module './livePersons'`, `isNeutralPerson is not a function`, the limits row undefined.

- [x] **Step 3: Implement the constants, the two predicates and `LivePersons`**

`limits.ts`: the six constants of the Interfaces block, each with a one-line doc comment citing §7.3/§7.4/§7.5 (K7, K8).

`edit/state.ts`: `isNeutralPerson` is `p.right === null` and every `PERSON_IDS` value within 1e-6 of `neutralPerson().values` (⊘ on 美型 and 一鍵 › 原圖 both set `right` to null, so §3.3's "edited back to neutral" still holds); `isNeutralPhoto` against `neutralPhoto().values` for every `PHOTO_IDS` key, plus `filterId === 'none' && look === null && heightBand === null`.

`app/livePersons.ts` (LF, pure, no DOM): the class's rules, which the tests above pin:
- A new `LivePersons` is open with no facing known (the first `resume` records one; the faceTracks tests never call `resume`); `clear()` closes it until the next `resume`.
- `reidDistance(prev, next, aspect)`: centre distance `Math.hypot((ncx − pcx) · aspect, ncy − pcy)` (frame-height units); `null` when it exceeds `REID_DIST · prev.w · aspect` or `max(next.w / prev.w, prev.w / next.w) > REID_SIZE`. `nearestUnambiguous`: the smallest `d`; `null` when another candidate has `d ≤ REID_AMBIGUITY × best` (two at 0 included).
- `write(ids, p)`: for ids the session knows (claimed and not yet forgotten: in view, held, or in the away pool); `isNeutralPerson(p)` → params `null`; bumps `version`.
- `claim`: candidates = pool entries with `now − lastSeen ≤ REID_GRACE_MS` that pass `reidDistance`; `nearestUnambiguous` → that id leaves the pool (and, when it is `returnTo`, the selection pins it); else a new id (`nextId++`).
- `release`: ignored while the session is closed (after `clear()`, until the next `resume`). The selection pinned on `id` → selection `'auto'`, `returnTo = id`. An edited id or the `returnTo` id enters the pool `{ id, box, lastSeen: now }`; the pool keeps `MAX_LIVE_FACES` entries (the oldest `lastSeen` evicted, its params forgotten, `returnTo` cleared if it was it); any other id is forgotten.
- `sync(inView, auto)`: stores both; under 全部套用 every id in `inView` not in the previous list gets the shared params (`null` included); bumps `version` only when the list, the auto pick or any param changed.
- `target()`: under 全部套用 the lead when in view, else the auto pick; otherwise the pinned id, else the auto pick; `null` with nothing in view.
- `pin(id)`: selection = id; `returnTo = null`. `edit(p, ids = editTargets())`: when not 全部套用, the selection is `'auto'` and `ids` holds the auto pick → pin it (K9); `returnTo = null`; `write(ids, p)`; under 全部套用 the shared params become `p` (`null` if neutral).
- `setAll(on)`: idempotent. On: `lead = target()`, shared = `params(lead)`, written to every id in view. Off: nothing reverts.
- `editTargets()`: 全部套用 → a copy of `inView`; else `[target()]`, or `[]`.
- `panelParams(lead)`: 全部套用 → shared ?? `neutralPerson()`; else `params(lead ?? target())` ?? `neutralPerson()`.
- `pause(now)`: `pausedAt ??= now`. `resume(now, facing)`: a known facing ≠ `facing` → `clear()` first; the session opens with `facing`; a pending pause of more than `LIVE_IDLE_MAX_MS` clears the pool and `returnTo`, a shorter one adds the span to every pool `lastSeen`.
- `clear()`: everything back to a new session (ids from 1, selection `'auto'`, 全部套用 off, ambient `neutralPerson()`), closed until `resume`.

- [x] **Step 4: Run the tests to verify they pass**

Run: `cd /d/GitSource/MonaLisa && npx vitest run src/app/livePersons.test.ts src/edit/state.test.ts src/config/limits.test.ts && npm run typecheck`
Expected: all PASS; typecheck exits 0.

- [x] **Step 5: Commit**

```bash
cd /d/GitSource/MonaLisa && git add src/config/limits.ts src/config/limits.test.ts src/edit/state.ts src/edit/state.test.ts src/app/livePersons.ts src/app/livePersons.test.ts && git commit -m "camera per-person: LivePersons, the camera session model (claim, release, selection, 全部套用, away pool, session clock)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" | cat
```

---

### Task 2: The camera lens option (labels, aria, ⊘, no-face gate)

**Files:**
- Modify: `src/edit/state.ts:113-116` (`cameraEdit`), `src/edit/state.test.ts:106-110`
- Modify: `src/edit/lens.ts:27-41` (copy, `LensOptions.camera`), `:42-80` (`Lens`), `:110-182` (`baseLensFor`), `:399-401` (`lensFor`), `src/edit/lens.test.ts:157`
- Modify: `src/ui/panelModel.ts:203` (`multiPerson`), `:220-226` (`personNote`), `:268` (`usable`), `:1045-1061` (preset items), `:1077` (美膚 gate), `:1275-1279` (`decorate`), `:1285-1297` (程度 slider); `src/ui/panelModel.test.ts`
- Modify: `src/ui/screens/Camera.tsx:79` (call site only: `cameraEdit(l.photo, l.person)`)

**Interfaces:**
- Consumes: `LIVE`, `LIVE_PERSONS` (`lens.ts:90`), `photoScoped` (`panelModel.ts:252`).
- Produces:
  ```ts
  // edit/state.ts
  export function cameraEdit(photo: PhotoParams, person: PersonParams): EditState; // { v: 2, photo, persons: { live: person }, template: person, primaryInit: null }
  // edit/lens.ts
  export const CAMERA_NO_FACE_NOTE = '未偵測到臉部，對準人臉後即可調整';
  export interface CameraLensInfo { shown: number; all: boolean; noFace: boolean; target: number | null }
  export interface LensOptions { available?(…): boolean; camera?: CameraLensInfo }
  export interface Lens { …; readonly multi: boolean; readonly camera: CameraLensInfo | null; readonly personOff: string | null }
  // ui/panelModel.ts
  export const CAMERA_TARGET = '選取的人物';
  ```

- [x] **Step 1: Write the failing tests**

`src/edit/lens.test.ts` (add; `one` is the file's existing selection helper; import `CAMERA_NO_FACE_NOTE` and `type LensOptions` from `./lens`, `personOf` from `./state`):

```ts
describe('the camera lens (camera per-person spec §3.2, §3.6)', () => {
  const photo = { ...neutralPhoto(), values: { ...neutralPhoto().values, 'skin.whiten': 0.8 } };
  const cam = (shown: number, all = false, noFace = false): LensOptions => ({ camera: { shown, all, noFace, target: 1 } });
  const lens = (o: LensOptions) => lensFor(cameraEdit(photo, naturalPerson()), one(LIVE), LIVE_PERSONS, LIVE, o);
  it('≥ 2 faces shown: ⊘ resets the target only; the photo items too under 全部套用 or with < 2 faces', () => {
    for (const [o, whiten] of [[cam(2), 0.8], [cam(2, true), 0], [cam(1), 0]] as const) {
      const e = lens(o).resetGroup('skin');
      expect(e.photo.values['skin.whiten']).toBe(whiten);
      expect(personOf(e, LIVE).values['skin.smooth']).toBe(neutralPerson().values['skin.smooth']);
    }
    expect([lens(cam(2)).multi, lens(cam(1)).multi]).toEqual([true, false]);
  });
  it('no face shown: person items write nothing and say why; photo items still write', () => {
    const l = lens(cam(0, false, true));
    expect(l.personOff).toBe(CAMERA_NO_FACE_NOTE);
    expect([l.targets('skin.smooth'), l.faceTargets()]).toEqual([[], []]);
    expect(l.applies('shape.eyeEnlarge')).toEqual({ ok: false, reason: CAMERA_NO_FACE_NOTE });
    expect(l.set('skin.smooth', 0.9)).toBe(l.edit);
    expect(l.set('skin.whiten', 1).photo.values['skin.whiten']).toBe(1);
    expect(l.applyPreset('natural', 1).persons).toBe(l.edit.persons);
  });
  it('without the camera option nothing changes: multi follows the persons, no personOff', () => {
    const l = lensFor(cameraEdit(photo, naturalPerson()), one(LIVE), LIVE_PERSONS, LIVE);
    expect([l.multi, l.camera, l.personOff]).toEqual([false, null, null]);
  });
});
```

`src/edit/state.test.ts:106-110`: the round-trip becomes `const e = cameraEdit(look.photo, look.person); expect(lookOf(e)).toEqual(look);`.

`src/ui/panelModel.test.ts` (add; import `CAMERA_NO_FACE_NOTE`, `LIVE_PERSONS` from `../edit/lens`, `cameraEdit`, `LIVE`, `neutralPhoto` from `../edit/state`, `CAMERA_TARGET`, `INITIAL_SELECTION`, `itemsFor`, `personNote`, `sliderFor` from `./panelModel`):

```ts
describe('the camera panel (camera per-person spec §3.2, §3.6)', () => {
  const sel = (skin: ParamId) => ({ ...INITIAL_SELECTION, tab: 'skin' as const, skin });
  const camLens = (shown: number, all = false, noFace = false) =>
    lensFor(cameraEdit(neutralPhoto(), naturalPerson()), { kind: 'person', id: LIVE }, LIVE_PERSONS, LIVE, { camera: { shown, all, noFace, target: 3 } });
  it('≥ 2 faces: photo items read 「· 整張照片」; person items name the selected person, or 全部 under 全部套用', () => {
    expect(sliderFor(camLens(2), sel('skin.whiten'))).toMatchObject({ label: '美白 · 整張照片', aria: '美白，整張照片' });
    expect(sliderFor(camLens(2), sel('skin.smooth'))).toMatchObject({ label: '磨皮', aria: `磨皮，${CAMERA_TARGET}`, key: 'c3:skin.smooth' });
    expect(sliderFor(camLens(2, true), sel('skin.smooth'))?.aria).toBe('磨皮，全部');
    const one = sliderFor(camLens(1), sel('skin.smooth'))!;
    expect([one.label, one.aria]).toEqual(['磨皮', undefined]);
  });
  it('no face shown: person items are off with the note, photo items stay; 一鍵 presets are off; 美型 / 美妝 dim', () => {
    const l = camLens(0, false, true);
    const skin = itemsFor(l, sel('skin.smooth'));
    expect(skin.find((i) => i.key === 'skin.smooth')).toMatchObject({ disabled: true, reason: CAMERA_NO_FACE_NOTE });
    expect(skin.find((i) => i.key === 'skin.whiten')?.disabled).toBe(false);
    expect(sliderFor(l, sel('skin.smooth'))).toBeNull();
    expect(sliderFor(l, sel('skin.whiten'))?.param).toBe('skin.whiten');
    expect(itemsFor(l, { ...INITIAL_SELECTION, tab: 'preset' }).every((i) => i.disabled)).toBe(true);
    expect(sliderFor(l, { ...INITIAL_SELECTION, tab: 'preset' })).toBeNull();
    expect(personNote('shape', l)).toEqual({ text: CAMERA_NO_FACE_NOTE, dim: true });
    expect(personNote('skin', l)).toEqual({ text: CAMERA_NO_FACE_NOTE, dim: false });
    expect(personNote('filter', l)).toBeNull();
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `cd /d/GitSource/MonaLisa && npx vitest run src/edit/lens.test.ts src/edit/state.test.ts src/ui/panelModel.test.ts`
Expected: FAIL — `CAMERA_NO_FACE_NOTE` / `CAMERA_TARGET` not exported, `multi` undefined, labels without the camera rule.

- [x] **Step 3: Implement**

- `cameraEdit(photo, person)` at `state.ts:113-116`; `lookOf` unchanged. Update the two call sites (`Camera.tsx:79`, `lens.test.ts:157`).
- `lens.ts` `baseLensFor`: `camera = opts.camera ?? null`; `multi = camera ? camera.shown >= 2 : persons.length >= 2`; `photoToo = sel.kind === 'all' || !!camera?.all || !multi` (replaces `:120`); `personOff = camera?.noFace ? CAMERA_NO_FACE_NOTE : null`; while `personOff`: `targets(id)` of a person item and `faceTargets()` are `[]`, and `applies(id)` of a person item is `no(personOff)` (checked before the existing rules; `lens.noFace` stays false, so 磨皮 never becomes an all-skin item in the camera). `withFaceDetail` passes `multi`, `camera`, `personOff` through.
- `panelModel.ts`: `multiPerson = (lens) => lens.multi`; `personNote` returns `{ text: lens.personOff, dim: tab === 'shape' || tab === 'makeup' }` for `skin | shape | makeup | preset` while `lens.personOff` (before its other rules); `usable = (lens, id) => (!multiPerson(lens) && !lens.personOff) || lens.applies(id).ok`; the 美膚 gate at `:1077` applies when `multiPerson(lens) || lens.personOff`; every preset item at `:1048-1058` is `gated(…, { ok: false, reason: lens.personOff })` while `personOff`; the 程度 slider (`:1290-1296`) returns `null` while `personOff`; `decorate`: `who = photo ? PHOTO_SCOPE : lens.sel.kind === 'all' || lens.camera?.all ? '全部' : lens.camera ? CAMERA_TARGET : \`人物 ${personNumber(lens, lens.sel.id)}\``, key prefix `lens.camera ? \`c${lens.camera.target ?? '-'}\` : selKey(lens)`.

- [x] **Step 4: Run the tests to verify they pass**

Run: `cd /d/GitSource/MonaLisa && npx vitest run src/edit src/ui && npm run typecheck`
Expected: all PASS (the editor's existing lens / panel tests unchanged); typecheck 0.

- [x] **Step 5: Commit** (CRLF check on `src/ui/panelModel.ts`, `src/ui/screens/Camera.tsx`)

```bash
cd /d/GitSource/MonaLisa && git add src/edit/state.ts src/edit/state.test.ts src/edit/lens.ts src/edit/lens.test.ts src/ui/panelModel.ts src/ui/panelModel.test.ts src/ui/screens/Camera.tsx && git commit -m "camera per-person: the camera lens option (≥ 2-face labels and aria, ⊘ rule, no-face gate); cameraEdit(photo, person)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" | cat
```

---

### Task 3: Tracks claim persons; the live loop renders each person

**Files:**
- Modify: `src/config/limits.ts:23-39` (`MAX_LIVE_FACES = MAX_EDIT_FACES`, its doc comment citing §6.1/§6.3), `src/config/limits.test.ts:13`
- Modify: `src/app/faceTracks.ts` (`:12-48` types, `:57-72` constructor, `:75-180` detect/feed, `:183-236` step/views/selection, `:257-264` reset, `:270-275` `cameraTapAction` types)
- Modify: `src/app/live.ts` (`:11-61` interfaces, `:91-102` `liveFrame`, `:104-253` loop, `:297-335` publish, `:374-413` the returned loop) — CRLF
- Create: `src/ui/cameraSession.ts`
- Modify: `src/types.ts:841` (debug box fields) — CRLF
- Modify: `src/ui/screens/Camera.tsx:62-67, :121-168, :194-198, :286-290, :293-313, :396-419` — CRLF; `src/ui/components/CameraFaceMarker.tsx:84, :108-109`
- Modify: `src/bench/main.ts:401-412` (CRLF), `tests/harness/t7/fakes.ts:226-271, :481`
- Test: `src/app/faceTracks.test.ts`, `src/app/live.test.ts`, `src/ui/components/CameraFaceMarker.test.tsx`

**Interfaces:**
- Consumes: Task 1's `LivePersons`, `TrackPersons`, `LivePersonId`, `reidDistance`, `nearestUnambiguous`, `TRACK_SIZE_JUMP`.
- Produces:
  ```ts
  // app/faceTracks.ts
  export type CameraSelection = 'auto' | LivePersonId;
  export interface LiveTrackView {
    id: TrackId; person: LivePersonId; box: Rect; rawBox: Rect; face: Face;
    weight: number; presence: number;
    edited: boolean;   // the person's params differ from 原圖
    selected: boolean; // the target's track (replaces `beautified`)
    present: boolean;
    seen: number;      // the track's last refresh (ms, the loop's clock)
    view: string;      // the view that last refreshed it ('video' on the solo path; §6.6 names in Task 8)
  }
  export class FaceTracks {
    constructor(persons: TrackPersons, opts?: { maxFaces?: number; holdMs?: number });
    detect(lms: readonly Landmarks478[] | null, tsMs: number, w: number, h: number): void;
    step(dtMs: number, nowMs: number): void;
    views(): LiveTrackView[];
    predicted(id: TrackId, nowMs: number): Rect | null;
    get anyFace(): number;
    hitTest(u: number, v: number, minW: number, minH: number): TrackId | null;
    reset(): void; // releases every track (person, last shown box, lastSeen)
  }
  export function cameraTapAction(hit: LivePersonId | null, shownTracks: number, selection: CameraSelection, allOn: boolean): TapAction; // rules unchanged
  // app/live.ts
  export interface LiveStats { …; target: LivePersonId | null; personsVersion: number }
  export interface LiveDeps { camera; engine; tracker; persons: LivePersons; getPhoto: () => PhotoParams; getPrefs; getFrame?; onStats? } // getLook and getAll are gone
  export interface LiveLoop {
    stop(): void; setCompare(on: boolean): void;
    capture(): { image: ImageData; seed: FaceSeed; persons: { rawBox: Rect; params: PersonParams }[] } | null;
    hitTest(u: number, v: number, minW: number, minH: number): LivePersonId | null;
    select(id: LivePersonId): void;
    selection(): CameraSelection;
    tracks(): LiveTrackView[];
  }
  export function liveFrame(views: readonly LiveTrackView[], anyFace: number, photo: PhotoParams, persons: Pick<LivePersons, 'params' | 'ambient'>): StillFrame;
  // ui/cameraSession.ts
  export function cameraSession(): LivePersons;   // the one instance, made on first use (a reload starts a new session)
  export function endCameraSession(): void;       // clear() and app.set({ cameraAll: false })
  // types.ts DebugState.boxes[]: { id; x; y; w; h; person?: string /* c{n} */; edited?: boolean; view?: string; seen?: number }
  ```

- [x] **Step 1: Write the failing tests**

`src/app/faceTracks.test.ts`: construct every tracker as `new FaceTracks(persons)`; `run()` loses its `all` argument and calls `t.step(33, now)`. Add helpers and these tests (keep the dedupe, A5, A7, hitTest, cover-mapping, ChipGate and maxFaces-1-smoother tests, reading the selection through `s.pin()` / `views().find((v) => v.selected)` instead of `select()` / `beautified()`):

```ts
import { MAX_LIVE_FACES } from '../config/limits';
import { naturalPerson } from '../edit/state';
import { LivePersons } from './livePersons';
/** a session in which every face is edited (全部套用 with 自然): weights behave as v0.5's beautified face */
function editedAll(): LivePersons {
  const s = new LivePersons();
  s.setAll(true);
  s.edit(naturalPerson());
  return s;
}

it('predicts each track by its velocity (EMA τ 200 ms), at most one box width away (§7.2)', () => {
  const t = new FaceTracks(new LivePersons());
  run(t, 10, (i) => [lmAt(0.3 + i * 0.005, 0.5, 0.2)]);
  const v = t.views()[0];
  const dx = t.predicted(v.id, 9 * 33 + 200)!.x - v.box.x;
  expect(dx).toBeGreaterThan(0.5 * (0.005 / 33) * 200);
  expect(dx).toBeLessThanOrEqual((0.005 / 33) * 200 + 1e-9);
  expect(t.predicted(v.id, 9 * 33 + 60_000)!.x - v.box.x).toBeCloseTo(v.box.w, 9);
});
it('two faces swap places, one passing behind the other for ~330 ms: each person follows its face', () => {
  const t = new FaceTracks(new LivePersons());
  const now = run(t, 10, () => [lmAt(0.35, 0.5, 0.15), lmAt(0.65, 0.5, 0.15)]);
  const [pb, pc] = [...t.views()].sort((a, b) => a.box.x - b.box.x).map((v) => v.person);
  for (let ms = 33; ms <= 1000; ms += 33) {
    const b = 0.35 + 0.0003 * ms;
    const c = 0.65 - 0.0003 * ms;
    t.detect(Math.abs(b - c) < 0.1 ? [lmAt(b, 0.5, 0.15)] : [lmAt(b, 0.5, 0.15), lmAt(c, 0.5, 0.15)], now + ms, W, H);
    t.step(33, now + ms);
  }
  const x = new Map(t.views().map((v) => [v.person, v.box.x + v.box.w / 2]));
  expect(x.get(pb)!).toBeGreaterThan(0.6);
  expect(x.get(pc)!).toBeLessThan(0.4);
});
it('a face twice as large where a track was is someone stepping in front: a new person; the covered one is held (TRACK_SIZE_JUMP)', () => {
  const t = new FaceTracks(new LivePersons());
  run(t, 5, () => [A()]);
  const [a] = t.views();
  run(t, 3, () => [lmAt(0.3, 0.5, 0.4)], 200);
  const v = t.views();
  expect(v).toHaveLength(2);
  expect(v.find((x) => x.id === a.id)).toMatchObject({ person: a.person, present: false });
  expect(v.find((x) => x.id !== a.id)!.person).not.toBe(a.person);
});
it('a lone face that jumps 0.8 widths is continued by the re-identification gates; one that jumps across the frame is a new person', () => {
  for (const [to, same] of [[0.3 + 0.8 * 0.2, true], [0.8, false]] as const) {
    const t = new FaceTracks(new LivePersons());
    let now = run(t, 10, () => [A()]);
    const p = t.views()[0].person;
    now = run(t, 5, () => [], now + 33);
    run(t, 3, () => [lmAt(to, 0.5, 0.2)], now + 33);
    const present = t.views().filter((v) => v.present);
    expect(present).toHaveLength(1);
    expect(present[0].person === p).toBe(same);
  }
});
it("maxFaces 1 keeps v0.3's one track, one face: a face anywhere continues the lone track", () => {
  const t = new FaceTracks(new LivePersons(), { maxFaces: 1 });
  run(t, 10, () => [A()]);
  const p = t.views()[0].person;
  run(t, 5, () => [lmAt(0.8, 0.5, 0.2)], 400);
  expect(t.views().map((v) => v.person)).toEqual([p]);
  expect(t.views()[0].box.x).toBeGreaterThan(0.6);
});
it(`tracks up to MAX_LIVE_FACES (${MAX_LIVE_FACES}); when full a new face evicts the oldest held track early, its person released`, () => {
  const s = editedAll();
  const t = new FaceTracks(s);
  const row = () => Array.from({ length: 10 }, (_, i) => lmAt(0.05 + i * 0.09, 0.5, 0.05));
  let now = run(t, 5, row);
  expect(t.views()).toHaveLength(10);
  const first = [...t.views()].sort((a, b) => a.box.x - b.box.x)[0];
  now = run(t, 3, () => row().slice(1), now + 33);
  run(t, 2, () => [...row().slice(1), lmAt(0.5, 0.15, 0.05)], now + 33);
  expect(t.views()).toHaveLength(10);
  expect(t.views().some((v) => v.id === first.id)).toBe(false);
  expect(s.claim(first.box, W / H, now + 200)).toBe(first.person);
});
it('a dropped track, and every track at reset(), goes to the away pool when edited (§7.5)', () => {
  const s = editedAll();
  const t = new FaceTracks(s);
  run(t, 5, () => [A(), B()]);
  const [va, vb] = [...t.views()].sort((a, b) => a.box.x - b.box.x);
  run(t, 40, () => [A()], 200);
  expect(t.views()).toHaveLength(1);
  t.reset();
  expect(t.views()).toHaveLength(0);
  expect(s.claim(va.box, W / H, 1700)).toBe(va.person);
  expect(s.claim(vb.box, W / H, 1700)).toBe(vb.person);
});
it("a face draws its person only when edited: untouched faces stay at weight 0 whoever is selected (§3.3)", () => {
  const s = new LivePersons();
  const t = new FaceTracks(s);
  run(t, 10, () => [A(), B(0.19)]);
  expect(t.views().map((v) => v.weight)).toEqual([0, 0]);
  const vb = t.views().find((v) => v.box.x > 0.5)!;
  s.write([vb.person], naturalPerson());
  run(t, 6, () => [A(), B(0.19)], 400);
  for (const v of t.views()) expect([v.edited, v.weight]).toEqual(v.person === vb.person ? [true, 1] : [false, 0]);
});
```

Rewrite, in the same file: the "doubles in size" tests (`:49-65`) as "the centre rule pairs a face that grew ×1.4 and moved 0.45 widths (assert `boxIoU` < 0.3 on the pair)"; the `it.each([3, 1])` far-jump test (`:155-180`) is replaced by the two continuation tests above; the crossfade test (`:126-142`) by the weight test above; "one face: the weight equals v0.3's single easer" (`:143-154`) runs on `editedAll()`. The `liveFrame → planFrame` describe (`:197-263`) calls `liveFrame(t.views(), t.anyFace, look.photo, s)` and asserts, for a pinned edited face leaving beside an untouched one, that the background 磨皮/紅潤 stay 0 on every frame and that once the edited face has faded out the plan is `{ mask: false, makeup: false, reshape: false, mean: false, adjust: false }` (A3).

`src/app/live.test.ts`: `setup()` gains `persons?: LivePersons` (default `editedAll(look.person)` where `look = splitLegacy(params)`), passes `getPhoto: () => look.photo` and no `getAll` (its `setAll` helper goes); the existing tests then keep their v0.5 expectations. The three direct `startLiveLoop({…})` calls (`:124`, `:591`, `:625`, all `tracker: null`) pass `persons: new LivePersons()` and `getPhoto: () => look.photo` (`splitLegacy(p).photo` at `:124`) in place of `getLook` / `getAll`. In the `live loop on face tracks` describe (`:515-577`), replace its first two tests (`:516-539`, they read `setAll` and the one look) with the describe below, and keep `LiveStats.faces counts the shown tracks` and `LiveStats.gpLeftOnLeft follows the tracked face` (`:540-576`): one face on the default session, whose selected track is its reference now:

```ts
describe('the live loop on persons (camera per-person spec §8, §7.5)', () => {
  const fresh = () => new LivePersons();
  it('each face renders its own person: the edited one at its params, the untouched one at 原圖 and weight 0', () => {
    const persons = fresh();
    const { engine, loop } = setup({ faces: 2, persons });
    vi.advanceTimersByTime(300);
    const right = loop.tracks().find((v) => v.box.x > 0.5)!;
    persons.write([right.person], naturalPerson());
    vi.advanceTimersByTime(300);
    const [a, b] = engine.lastInput()!.faces;
    expect(a).toMatchObject({ weight: 1, person: naturalPerson() });
    expect(b).toMatchObject({ weight: 0, person: neutralPerson() });
    expect(engine.lastInput()!.globalSkin).toEqual({ smooth: 0, rosy: 0, weight: 0 });
    loop.stop();
  });
  it('基本模式 draws the ambient person on all skin; with a tracker the global skin is 原圖 (§3.6, K11)', () => {
    const persons = fresh();
    persons.setAmbient(naturalPerson());
    const basic = setup({ tracker: false, persons });
    vi.advanceTimersByTime(100);
    expect(basic.engine.lastInput()!.globalSkin).toMatchObject({ smooth: naturalPerson().values['skin.smooth'], weight: 1 });
    basic.loop.stop();
  });
  it('liveFrame orders present edited faces first, then present, then held, cut at MAX_RENDER_FACES', () => {
    const persons = fresh();
    const ids = Array.from({ length: 12 }, () => persons.claim({ x: 0.4, y: 0.4, w: 0.1, h: 0.1 }, 16 / 9, 0));
    persons.write(ids.filter((id) => id % 2 === 1), naturalPerson());
    const view = (id: number): LiveTrackView => ({
      id, person: id, box: { x: 0.4, y: 0.4, w: 0.1, h: 0.1 }, rawBox: { x: 0.4, y: 0.4, w: 0.1, h: 0.1 }, face: makeFace(id),
      weight: 0, presence: 1, edited: persons.edited(id), selected: false, present: id > 4, seen: 0, view: 'video',
    });
    const f = liveFrame(ids.map(view), 1, look.photo, persons);
    expect(f.faces.map((x) => x.face.pts111[0])).toEqual([5, 7, 9, 11, 6, 8, 10, 12, 1, 2]);
    expect(f.faces[0].person).toEqual(naturalPerson());
    expect(f.faces[4].person).toEqual(neutralPerson());
  });
  it('pause and stop release the tracks into the away pool; the next live frame re-identifies them in place', () => {
    const persons = fresh();
    const { camera, loop } = setup({ persons });
    vi.advanceTimersByTime(300);
    const p = loop.tracks()[0].person;
    persons.write([p], naturalPerson());
    camera.set({ state: 'interrupted' });
    vi.advanceTimersByTime(20_000);
    camera.set({ state: 'live' });
    vi.advanceTimersByTime(100);
    expect(loop.tracks()[0].person).toBe(p);
    loop.stop();
    const again = setup({ persons });
    vi.advanceTimersByTime(100);
    expect(again.loop.tracks()[0].person).toBe(p);
    again.loop.stop();
  });
  it.each([true, false])('Review Focus #1: a flip (session ended first: %s) never hands a front-camera person to the back camera', (ended) => {
    const persons = fresh();
    const { camera, loop } = setup({ persons });
    vi.advanceTimersByTime(300);
    persons.write([loop.tracks()[0].person], naturalPerson());
    if (ended) persons.clear();
    camera.set({ state: 'starting' });
    camera.set({ state: 'live', facing: 'environment' });
    vi.advanceTimersByTime(300);
    expect(persons.edited(loop.tracks()[0].person)).toBe(false);
    loop.stop();
  });
  it('select pins a person; capture hands over every edited person in view and the seed of the target, or all', () => {
    const persons = fresh();
    const { loop } = setup({ faces: 2, persons });
    vi.advanceTimersByTime(600);
    const right = loop.tracks().find((t) => t.box.x > 0.5)!;
    expect(loop.hitTest(right.box.x + right.box.w / 2, 0.5, 0.01, 0.01)).toBe(right.person);
    loop.select(right.person);
    persons.edit(naturalPerson());
    vi.advanceTimersByTime(300);
    const shot = loop.capture()!;
    const now = loop.tracks().find((t) => t.person === right.person)!;
    expect(shot.seed).toEqual({ x: now.rawBox.x + now.rawBox.w / 2, y: now.rawBox.y + now.rawBox.h / 2 });
    expect(shot.persons).toEqual([{ rawBox: now.rawBox, params: naturalPerson() }]);
    persons.setAll(true);
    expect(loop.capture()!.seed).toBe('all');
    loop.stop();
  });
  it('debug: boxes carry c{n} and edited; selected is the target track; passes are the last frame’s; LiveStats.target is emitted at once', () => {
    const persons = fresh();
    const { loop, stats, engine } = setup({ faces: 2, persons });
    engine.render.mockImplementation((i) => ({ cpuMs: 0, width: i.width, height: i.height, passes: ['composite'] }));
    vi.advanceTimersByTime(600);
    const d = dbg()!;
    expect(d.boxes.map((b) => [b.person, b.edited])).toEqual(loop.tracks().map((t) => [`c${t.person}`, false]));
    const sel = loop.tracks().find((t) => t.selected)!;
    expect(d.selected).toBe(`t${sel.id}`);
    expect(d.passes).toEqual(['composite']);
    const n = stats.length;
    loop.select(loop.tracks().find((t) => !t.selected)!.person);
    vi.advanceTimersByTime(34);
    expect(stats.slice(n).some((s) => s.target !== stats[n - 1].target)).toBe(true);
    loop.stop();
  });
});
```

(`editedAll(p)` in this file is the faceTracks helper above with `p` instead of 自然; import `LivePersons`, `liveFrame`, `LiveTrackView`, `makeFace`, `naturalPerson`, `neutralPerson`.)

`src/ui/components/CameraFaceMarker.test.tsx:126-138`: `view(id, x, selected)` builds `{ id, person: id, box, rawBox, weight: 1, presence: 1, edited: false, selected, present: true, seen: 0, view: 'video' }`; the ring is `{ person, at }`.

- [x] **Step 2: Run the tests to verify they fail**

Run: `cd /d/GitSource/MonaLisa && npx vitest run src/app/faceTracks.test.ts src/app/live.test.ts src/ui/components/CameraFaceMarker.test.tsx`
Expected: FAIL — `FaceTracks` takes no persons, `predicted` / `person` / `selected` missing, `LiveDeps.persons` unknown.

- [x] **Step 3: Implement `FaceTracks` on persons**

`Track` gains `person`, `vx`, `vy` (UV per ms), `view`. The `sel` / `autoId`-as-selection state and `select()` / `selection()` / `beautified()` (`:60-61, :163, :226-236`) leave `FaceTracks` (the A7 pick and its challenger stay). `detect()` keeps its dedupe (`:94-102`) and A5 null path (`:76-87`); then:

1. `aspect = w / h`; each track's **predicted box** `predicted(t, ts)`:
   ```ts
   const dt = Math.max(0, ts - t.lastSeen);
   let dx = t.vx * dt, dy = t.vy * dt;
   const len = Math.hypot(dx * aspect, dy), max = t.box.w * aspect;
   if (len > max) { dx *= max / len; dy *= max / len; }
   return { ...t.box, x: t.box.x + dx, y: t.box.y + dy };
   ```
2. Greedy IoU ≥ 0.3 then centre ≤ 0.5 predicted widths (today's two rules, `:103-134`), both against predicted boxes, each pair refused when `max(d.box.w / p.w, p.w / d.box.w) > TRACK_SIZE_JUMP`.
3. **Continuation:** each unmatched detection, largest first, may take a free track still within the hold whose predicted box passes `reidDistance(pred, d.box, aspect)`; among several, `nearestUnambiguous` (none → no continuation). With `maxFaces === 1` the one-track rule (`:135-142`) stays as well (the v0.3 fallback has one person).
4. `feed` (`:167-180`) also updates the velocity from the raw box centres: `inst = Δcentre / (ts − lastSeen)`, `v += (inst − v) · (1 − exp(−(ts − lastSeen) / 200))`.
5. Unmatched detections start tracks, largest first, each `persons.claim(d.box, aspect, ts)`; when `list.length === max`, the held track with the oldest `lastSeen` is dropped first (released), and only if there is one.
6. Free tracks: `present = false`. Tracks missing longer than the hold are dropped with `persons.release(t.person, t.box, t.lastSeen)`.

`step(dtMs, nowMs)`: the A7 pick (`:184-198`) → `persons.sync(list.map((t) => t.person), autoTrack?.person ?? null)`, then `t.easer.update(t.present && persons.edited(t.person), dtMs)`; presence and `any` as today. `views()` fills `edited` from `persons.edited`, `selected` from `t.person === persons.target()`. `reset()` releases every track (person, last shown box, `lastSeen`), clears, then `persons.sync([], null)`, so `target()` is null while nobody is in view (a paused camera has no target to write). `cameraTapAction` keeps its body; only its parameter types change.

- [x] **Step 4: Implement the loop on persons, the session singleton and the call sites**

`live.ts`:
- `liveFrame(views, anyFace, photo, persons)`: views with `weight > 0 || presence > 0`, stably ordered (present ∧ edited, present, held), cut at `MAX_RENDER_FACES`, each `{ face, weight, person: persons.params(v.person) ?? neutralPerson(), protect: null, presence }`; `globalSkin: { smooth: persons.ambient.values['skin.smooth'], rosy: persons.ambient.values['skin.rosy'], weight: 1 − anyFace }`; `photo`.
- `const persons = deps.persons; const tracks = new FaceTracks(persons);` `resetSession(geo, now)` (`:233-244`, called with `info.now`) runs `tracks.reset()` then `persons.resume(now, camera.snapshot.facing)`. `pause()` (`:246-253`) runs `tracks.reset()` and `persons.pause(lastTs ?? performance.now())` before nulling `lastTs`; `stop()` does the same when not already paused.
- `draw()` keeps the `RenderStats` of `engine.render` and `publish` writes `dbg.passes` from it; `dbg.boxes` gain `person: \`c${v.person}\``, `edited`, `view`, `seen`; `dbg.selected` = `persons.all() ? 'all' : (selected view ? \`t${id}\` : null)`; the 左／右 reference (`:300`) is the `selected` view; `LiveStats` gains `target: persons.target()`, `personsVersion: persons.version`, both in the "emit at once" test (`:329-330`).
- `capture()`: as today with `liveFrame(…, deps.getPhoto(), persons)`; `persons` = views with `edited` → `{ rawBox, params: persons.params(person)! }`; seed from the `selected` view, `'all'` while `persons.all()`.
- `hitTest` maps the track id to its person; `select(id)` → `persons.pin(id)`; `selection()` → `persons.selection()`.

`src/ui/cameraSession.ts` (LF): the two functions of the Interfaces block (`app` from `./state`).

Call sites: `Camera.tsx` passes `persons: cameraSession()`, `getPhoto: () => lookRef.current.photo` (and drops `getLook` / `getAll`); `onStageClick` works in person ids; the ring state is `{ person: LivePersonId; at: number }`; the 全部套用 chip and a tap's `allOff` also call `cameraSession().setAll(v)`; `close()` and `flip()` call `endCameraSession()` **before** `stopCamera()` / `ctrl.flip()` (Review Focus #1). `CameraFaceMarker.tsx`: `ring.person`, `showDot = dotOn && v.selected`. `bench/main.ts:401-412`: a module-level `LivePersons` with `setAll(true)` and `edit(splitLegacy(params).person)` (again in `setMode`), `getPhoto: () => splitLegacy(params).photo`. `tests/harness/t7/fakes.ts`: `fakeFrame(photo, ambient)` reads `d.getPhoto()` and `d.persons.ambient`; its stats add `target: null, personsVersion: 0`; `capture` returns `persons: []`.

`limits.ts:30`: `export const MAX_LIVE_FACES = MAX_EDIT_FACES;` with the doc comment rewritten from §6.1 (front `numFaces` 10 costs what 3 cost: 14.1 vs 14.2 ms GPU, 14.1 vs 14.3 ms CPU); `limits.test.ts:13` expects 10.

- [x] **Step 5: Run the tests to verify they pass**

Run: `cd /d/GitSource/MonaLisa && npx vitest run src/app src/ui src/config && npm run typecheck`
Expected: all PASS; typecheck 0.

- [x] **Step 6: Commit** (CRLF check on `live.ts`, `types.ts`, `Camera.tsx`, `bench/main.ts`)

```bash
cd /d/GitSource/MonaLisa && git add src/config src/app/faceTracks.ts src/app/faceTracks.test.ts src/app/live.ts src/app/live.test.ts src/ui/cameraSession.ts src/types.ts src/ui/screens/Camera.tsx src/ui/components/CameraFaceMarker.tsx src/ui/components/CameraFaceMarker.test.tsx src/bench/main.ts tests/harness/t7/fakes.ts && git commit -m "camera per-person: tracks claim persons (prediction, size gate, re-identification), each face renders its own person, MAX_LIVE_FACES 10" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" | cat
```

---

### Task 4: The camera panel edits one person at a time

**Files:**
- Modify: `src/ui/cameraSession.ts`; Create: `src/ui/cameraSession.test.ts`
- Modify: `src/ui/screens/Camera.tsx:41-90` (lens, setEdit), `:128-138` (onStats), `:440-448` (SliderRow), `:468-480` (BeautyPanel) — CRLF
- Modify: `src/store/settings.ts:49-78` (K15), `src/store/settings.test.ts:323-390`
- Modify: `src/ui/state.ts:72-73, :84-85` (comments only) — CRLF
- Modify: `tests/e2e/camera-group.spec.ts:26-101` (changed on purpose, §12.2), `tests/e2e/original.spec.ts:200-202, :247-248`

**Interfaces:**
- Consumes: Task 1 `LivePersons.edit / editTargets / panelParams / setAmbient`; Task 2 `LensOptions.camera`, `CAMERA_NO_FACE_NOTE`; Task 3 `cameraSession`, `LiveStats.personsVersion`.
- Produces:
  ```ts
  // ui/cameraSession.ts
  /** a slider drag in progress: the persons it writes, the person the panel shows, and the slider binding it started on */
  export interface CameraDrag { ids: readonly LivePersonId[]; lead: LivePersonId | null; key: string }
  export function beginDrag(s: LivePersons, key: string): CameraDrag;                     // { ids: s.editTargets(), lead: s.target(), key }
  /** the drag while the slider row still shows the binding it started on (`shownKey`: the shown binding's key, null with no slider shown); else null */
  export function keepDrag(drag: CameraDrag | null, shownKey: string | null): CameraDrag | null;
  export function panelPerson(s: LivePersons, drag: CameraDrag | null): PersonParams;      // s.panelParams(drag?.lead)
  export function writePerson(s: LivePersons, p: PersonParams, drag: CameraDrag | null): void; // s.edit(p, drag?.ids)
  ```

- [x] **Step 1: Write the failing tests**

`src/ui/cameraSession.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

// the app store without deps (as screens/hooks.test.ts mocks it)
vi.mock('./state', () => {
  let s: Record<string, unknown> = { cameraAll: false };
  return { app: { get: () => s, set: (p: Record<string, unknown>) => void (s = { ...s, ...p }) } };
});

import { LivePersons } from '../app/livePersons';
import { naturalPerson, neutralPerson, personFromPreset } from '../edit/state';
import { beginDrag, cameraSession, endCameraSession, keepDrag, panelPerson, writePerson } from './cameraSession';
import { app } from './state';

const at = (cx: number) => ({ x: cx - 0.05, y: 0.35, w: 0.1, h: 0.3 });
it('Review Focus #3: a drag keeps writing the person it started on when the target changes mid-drag', () => {
  const s = new LivePersons();
  s.resume(0, 'user');
  const a = s.claim(at(0.3), 16 / 9, 0);
  const b = s.claim(at(0.7), 16 / 9, 0);
  s.sync([a, b], a);
  const d = beginDrag(s, `c${a}:skin.smooth`);
  writePerson(s, naturalPerson(), d); // the first write pins a (K9)
  s.release(a, at(0.3), 100);         // a leaves mid-drag
  s.sync([b], b);
  expect(s.target()).toBe(b);
  // the panel keys its slider on the drag's lead while the drag runs (Step 3), so the row still shows the same binding
  expect(keepDrag(d, `c${a}:skin.smooth`)).toBe(d);
  writePerson(s, personFromPreset('refined', 1), d);
  expect([s.params(a), s.params(b)]).toEqual([personFromPreset('refined', 1), null]);
  expect(panelPerson(s, d)).toEqual(personFromPreset('refined', 1));
  expect(panelPerson(s, null)).toEqual(neutralPerson());
});
it('Review Focus #3: a drag the slider row dropped without a commit (no slider shown, or another binding) never carries into the next drag', () => {
  const s = new LivePersons();
  s.resume(0, 'user');
  const a = s.claim(at(0.3), 16 / 9, 0);
  const b = s.claim(at(0.7), 16 / 9, 0);
  s.sync([a, b], a);
  const d = beginDrag(s, `c${a}:skin.smooth`);
  writePerson(s, naturalPerson(), d);
  // the last face left (person items off: no slider), the camera paused or flipped (no row), or the tab changed
  expect([keepDrag(d, null), keepDrag(d, `c${a}:shape.faceSlim`)]).toEqual([null, null]);
  s.pin(b);
  const next = keepDrag(null, `c${b}:skin.smooth`) ?? beginDrag(s, `c${b}:skin.smooth`);
  expect([next.ids, next.lead]).toEqual([[b], b]);
  writePerson(s, personFromPreset('refined', 1), next);
  expect([s.params(a), s.params(b)]).toEqual([naturalPerson(), personFromPreset('refined', 1)]);
});
it('endCameraSession clears the one session and turns 全部套用 off', () => {
  const s = cameraSession();
  s.resume(0, 'user');
  s.setAll(true);
  app.set({ cameraAll: true });
  endCameraSession();
  expect([cameraSession() === s, s.all(), app.get().cameraAll]).toEqual([true, false, false]);
});
```

`src/store/settings.test.ts` (camera-look describe, `:323-390`): the migration test (`:324-333`) expects `toEqual({ ...splitLegacy(p), person: neutralPerson() })` and the stored value the same; the round-trip (`:334-342`) expects `{ ...look, person: neutralPerson() }` and drops its `person` sanitize check (`:341`); "a stored look keeps what it holds" (`:375-390`) expects `{ ...glow, person: neutralPerson() }`, keeps its photo checks and drops the `person.values` ones (`:388-389`); add:

```ts
it('K15: the stored person is never read; every save writes it as 原圖; the photo part round-trips', () => {
  const glow = splitLegacy(applyPreset('glow', 1));
  store.setItem(LOOK_KEY, JSON.stringify(glow));
  expect(loadLook()).toEqual({ photo: glow.photo, person: neutralPerson() });
  saveLook(glow);
  expect(JSON.parse(store.getItem(LOOK_KEY)!).person).toEqual(neutralPerson());
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `cd /d/GitSource/MonaLisa && npx vitest run src/ui/cameraSession.test.ts src/store/settings.test.ts`
Expected: FAIL — `beginDrag` not exported; the stored person still read.

- [x] **Step 3: Implement the drag helpers, K15 and the Camera wiring**

- `cameraSession.ts`: the four functions of the Interfaces block.
- `settings.ts`: `sanitizeLook(raw)` returns `{ photo: sanitizePhoto(r.photo), person: neutralPerson() }`; `saveLook` writes it; the legacy migration (`:71-73`) writes `sanitizeLook(look)`. Doc comment cites K15 and §9.
- `Camera.tsx`:
  - `state`, `ready`, `faceNote` and `faceOff` (`:316-320`) move above `binding` (`:315`): `lensOf` and `keepDrag` read them, and a `const` read before its declaration throws.
  - `const session = cameraSession();` `const drag = useRef<CameraDrag | null>(null);` a `personsTick` state set from `onStats` (`s.personsVersion`) so a target or param change re-renders the panel; `setEdit` bumps it too, so a write re-renders the panel whether or not a loop is running (基本模式 before the stream is live included).
  - `lensOf(l)`: `basic = !!bundle?.basic`; person = `basic ? session.ambient : panelPerson(session, drag.current)`; `lensFor(cameraEdit(l.photo, person), { kind: 'person', id: LIVE }, livePersons, LIVE, { camera: { shown: shownFaces, all: cameraAll, noFace: !basic && ready && shownFaces === 0, target: drag.current?.lead ?? session.target() } })`. `noFace` does not read `trackerHealth`: with no shown face there is no target, so a person slider would write nobody and snap back; while the tracker restarts its badge (`Camera.tsx:422-426`) says why, and the strip note waits for a face as §3.6 says.
  - Every render, right after `binding = sliderFor(lensOf(look), …)`: `drag.current = keepDrag(drag.current, ready && !collapsed && !faceOff ? (binding?.key ?? null) : null)`. `SliderRow` drops its own drag without `onCommit` whenever its key changes or it unmounts (`Slider.tsx:104-110`); this is the same render, so a dropped drag never writes again (Review Focus #3). When `keepDrag` drops a drag, compute `binding` again before rendering (its lens then keys and reads the session's target, not the dropped drag's lead), so the row and the next `beginDrag` agree on the key. `close()` and `flip()` also set `drag.current = null`.
  - `setEdit(e, from = lensOf(lookRef.current))`: photo changed (`e.photo !== from.edit.photo`) → `setLook({ photo: e.photo, person: neutralPerson() })`; person changed (`personOf(e, LIVE) !== personOf(from.edit, LIVE)`) → `basic ? session.setAmbient(person) : writePerson(session, person, drag.current)`. The slider passes the lens it applied (`const l = lensOf(lookRef.current); setEdit(binding.apply(l, v), l)`); `BeautyPanel` gets the render's lens (`const lens = lensOf(look)`, passed as `lens={lens}` and `onEdit={(e) => setEdit(e, lens)}`).
  - `SliderRow`: `onChange(v)`: `drag.current ??= beginDrag(session, binding.key)`, then apply; `onCommit(v)`: apply, then `drag.current = null`.
- `state.ts` comments: `look` holds the photo look (its `person` stays 原圖, K15); `cameraAll` resets with the camera session (`endCameraSession`).

- [x] **Step 4: Run the unit tests**

Run: `cd /d/GitSource/MonaLisa && npx vitest run src/ui src/store && npm run typecheck`
Expected: PASS; typecheck 0.

- [x] **Step 5: Update the e2e specs changed on purpose**

`tests/e2e/camera-group.spec.ts` (first test): after the three faces are found, 一鍵 › 自然 now edits and pins the auto target (the largest, A); 美白 / 銳化 to 0 as before. Tap B: `selected` is B; B is 原圖 until edited, so apply 一鍵 › 自然 to B and set 美白 / 銳化 back to 0 (the preset's photo part re-applies them to the whole frame; the same `ArrowLeft` loop as `:50-56`), then assert `regionDiff(original, beautified, gb.rect).inside > 0.5` (B adjusted), the same `> 0.5` for A (A keeps its result, U3), and `< 0.3` for C (untouched). 全部套用: the chip copies B's params to everyone, so C's region now differs (`> 0.5`); a tap on C turns it off and selects C, and C's region still differs (nobody reverts). The hand-over part (B selected → 編輯 selects B) is unchanged.
`tests/e2e/original.spec.ts`: the poll at `:200-202` reads `JSON.parse(localStorage.getItem('meiyan.look.v1')).photo.values['skin.whiten']` (`1`) and `person.preset.id` (`'original'`); `:248` expects `'original'`.

- [x] **Step 6: Run the camera e2e specs**

Run: `cd /d/GitSource/MonaLisa && npm run build && npx playwright test tests/e2e/camera.spec.ts tests/e2e/original.spec.ts --project chromium && npx playwright test tests/e2e/camera-group.spec.ts --project chromium-group`
Expected: all pass (the original.spec camera test still opens the shot at 原圖: the hand-over lands in Task 11).

- [x] **Step 7: Commit** (CRLF check on `Camera.tsx`, `state.ts`)

```bash
cd /d/GitSource/MonaLisa && git add src/ui/cameraSession.ts src/ui/cameraSession.test.ts src/ui/screens/Camera.tsx src/store/settings.ts src/store/settings.test.ts src/ui/state.ts tests/e2e/camera-group.spec.ts tests/e2e/original.spec.ts && git commit -m "camera per-person: the panel edits the selected person (drag keeps its target), 全部套用 copies, meiyan.look.v1 keeps only the photo look (K15)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" | cat
```

---

### Task 5: Tracker: the photo detector in VIDEO, `OffscreenCanvas` input, `detectView`, `warm()`

**Files:**
- Modify: `src/tracking/tracker.ts:56` (`ImageInput`), `:399-431` (`setMode`), `:438-472` (`detectVideo`, `detectImage`), add `detectView` after `detectImage` and `warm` before `close` — CRLF
- Modify: `src/types.ts:509-532` (`Tracker`) — CRLF; add `export type FaceDetectorKind = 'photo' | 'camera';`
- Modify: `src/geometry/upFrame.ts:149-170` (`upTracker` forwards `detectView` and `warm`), `src/geometry/upFrame.test.ts:172-181, :202-211` (its two `Tracker` literals gain `detectView: () => null, warm() {}`), `src/app/testFakes.ts:261-293` (`detectView`, `warm`) — CRLF, `tests/harness/t7/fakes.ts:481` (`detectView: () => null, warm() {}`)
- Test: `src/tracking/tracker.test.ts`

**Interfaces:**
- Produces:
  ```ts
  detectVideo(video: HTMLVideoElement, tsMs: number, opts: { maxFaces: number; detector?: FaceDetectorKind }): Landmarks478[] | null; // default 'camera'
  detectImage(image: ImageBitmap | HTMLCanvasElement | HTMLImageElement | OffscreenCanvas, opts: { maxFaces: number; detector?: FaceDetectorKind }): Landmarks478[]; // default 'photo'
  /**
   * The group path's IMAGE call (§6.6) with the live path's guards: null = no answer (closed, an empty view, the instance
   * unusable or being replaced, the rebuild throttle), as detectVideo; [] = a completed inference without a face. Throws
   * as detectVideo. detectImage answers [] in those cases (its callers keep a health check), which the live loop would
   * take for "no face" and drop every track after LOST_HOLD_MS (A5).
   */
  detectView(view: OffscreenCanvas | HTMLCanvasElement, opts: { maxFaces: number; detector: FaceDetectorKind }): Landmarks478[] | null;
  /** switch the graph to `mode` (count: IMAGE EDIT_DETECT_FACES, VIDEO LIVE_DETECT_FACES) and `detector`'s bundle, then run one call on a 64 × 64 blank OffscreenCanvas; never throws, no-op when closed or dead */
  warm(mode: 'VIDEO' | 'IMAGE', detector: FaceDetectorKind): void;
  // testFakes.ts FakeTracker: detectView: vi.fn(() => { clock?.work(t.cost); return t.unusable ? null : t.face ? faces() : []; }); warm: vi.fn()
  ```

- [x] **Step 1: Write the failing tests** (inside the full-range describe, `tracker.test.ts:478`, reusing `makeWith`, `sent`, `shape`, `FULL`)

```ts
it("detectVideo with detector 'photo' runs the photo bundle in VIDEO, switching once; the default stays the camera bundle", async () => {
  const t = await makeWith(() => FULL);
  const lm = last();
  t.detectVideo(video, 1, { maxFaces: LIVE_DETECT_FACES, detector: 'photo' });
  t.detectVideo(video, 2, { maxFaces: LIVE_DETECT_FACES, detector: 'photo' });
  expect(sent(lm).map(shape)).toEqual([{ model: 'photo', runningMode: 'VIDEO', numFaces: LIVE_DETECT_FACES }]);
  t.detectVideo(video, 3, ONE);
  expect(sent(lm).map(shape).at(-1)).toEqual({ model: 'camera', runningMode: 'VIDEO', numFaces: LIVE_DETECT_FACES });
});
it('detectImage takes an OffscreenCanvas (a group-path view)', async () => {
  const t = await makeWith(() => FULL);
  const c = new OffscreenCanvas(720, 720);
  expect(t.detectImage(c, { maxFaces: EDIT_DETECT_FACES })).toHaveLength(1);
  expect(last().detect).toHaveBeenCalledWith(c);
});
it("detectView: IMAGE on a view with the live guards: null while the rebuild throttle holds or the instance is dead (detectImage says [] there), [] for no face", async () => {
  const { REBUILD_INTERVAL_MS } = await load();
  const t = await makeWith(() => FULL);
  const lm = last();
  const v = new OffscreenCanvas(720, 720);
  const o = { maxFaces: EDIT_DETECT_FACES, detector: 'photo' } as const;
  expect(t.detectView(v, o)).toHaveLength(1);
  expect(lm.detect).toHaveBeenCalledWith(v);
  expect(sent(lm).map(shape).at(-1)).toEqual({ model: 'photo', runningMode: 'IMAGE', numFaces: EDIT_DETECT_FACES });
  lm.detect.mockImplementation(() => {
    throw new Error('Graph has errors');
  });
  expect(() => t.detectView(v, o)).toThrow(); // failure 1
  expect(() => t.detectView(v, o)).toThrow(); // the immediate rebuild, failure 2
  expect(t.detectView(v, o)).toBeNull(); // throttled: no inference, no answer
  expect(lm.detect).toHaveBeenCalledTimes(3);
  lm.detect.mockImplementation(() => ({ faceLandmarks: [] }));
  vi.advanceTimersByTime(REBUILD_INTERVAL_MS);
  expect(t.detectView(v, o)).toEqual([]);
  lm.canvas!.lose(false); // found by the poll: the instance is retired and replaced
  expect(t.detectView(v, o)).toBeNull();
  expect(t.detectImage(image, { maxFaces: EDIT_DETECT_FACES })).toEqual([]);
});
it("a replacement made while full-range VIDEO ran starts on the camera bundle; the next detectVideo with detector 'photo' switches it back", async () => {
  const t = await makeWith(() => FULL);
  t.detectVideo(video, 1, { maxFaces: LIVE_DETECT_FACES, detector: 'photo' });
  last().canvas!.lose(true);
  await vi.advanceTimersByTimeAsync(500);
  const second = last();
  expect(second.opts.baseOptions.modelAssetBuffer).toBe(CAMERA);
  t.detectVideo(video, 2, { maxFaces: LIVE_DETECT_FACES, detector: 'photo' });
  expect(sent(second).map(shape)).toEqual([{ model: 'photo', runningMode: 'VIDEO', numFaces: LIVE_DETECT_FACES }]);
});
it.each([
  ['IMAGE', 'photo', { model: 'photo', runningMode: 'IMAGE', numFaces: EDIT_DETECT_FACES }, 'detect'],
  // the graph holds the photo bundle from the detectImage below, so going back to VIDEO carries the camera bundle
  ['VIDEO', 'camera', { model: 'camera', runningMode: 'VIDEO', numFaces: LIVE_DETECT_FACES }, 'detectForVideo'],
  ['VIDEO', 'photo', { model: 'photo', runningMode: 'VIDEO', numFaces: LIVE_DETECT_FACES }, 'detectForVideo'],
] as const)('warm(%s, %s) switches the graph and runs one call on a 64 × 64 blank canvas', async (mode, det, want, call) => {
  const t = await makeWith(() => FULL);
  const lm = last();
  if (mode === 'VIDEO' && det === 'camera') t.detectImage(image, { maxFaces: 8 }); // leave VIDEO first
  t.warm(mode, det);
  expect(sent(lm).map(shape).at(-1)).toEqual(want);
  const arg = lm[call].mock.calls.at(-1)![0] as FakeCanvas;
  expect([arg.width, arg.height]).toEqual([64, 64]);
});
it('warm never throws: a closed tracker or a throwing inference is a no-op (noted once)', async () => {
  const t = await makeWith(() => FULL);
  last().detect.mockImplementation(() => { throw new Error('graph'); });
  expect(() => t.warm('IMAGE', 'photo')).not.toThrow();
  t.close();
  expect(() => t.warm('VIDEO', 'camera')).not.toThrow();
});
```

- [x] **Step 2: Run to verify they fail**

Run: `cd /d/GitSource/MonaLisa && npx vitest run src/tracking/tracker.test.ts`
Expected: FAIL — `t.detectView` / `t.warm is not a function`; VIDEO never carries the photo model.

- [x] **Step 3: Implement**

`setMode(m, n, detector)` (`:403-404`): `want = detector === 'photo' && fullRange() ? 'photo' : 'camera'` for both modes (the photo bundle in VIDEO is used only by the fallback, §6.3). `detectVideo` passes `o.detector ?? 'camera'`; `detectImage` passes `o.detector ?? 'photo'`; `ImageInput` adds `OffscreenCanvas` (`imageSize` already reads `width/height`). `warm` follows `detectImage`'s guards (`closed`, `usable()`), runs `setMode`, then `detect(blank)` or `detectForVideo(blank, ts)` with `ts = lastTs + 1` bookkeeping as `detectVideo` does; a throw goes through `failed('warm', e)` and is swallowed. The blank is a cached `OffscreenCanvas(64, 64)` (a 2D-cleared canvas). `detectView` runs `detectVideo`'s guards in its order (`closed` → null; an empty view → null; `!usable()` → null; `needsRebuild` within `REBUILD_INTERVAL_MS` of the last rebuild → null), then `detectImage`'s body (`setMode('IMAGE', clampFaces(o.maxFaces), o.detector)`, `detect(view)`, `succeeded`; a throw is rethrown through `failed('detectView', e)`). Replacement instances still start on the camera bundle (`:319-323`, unchanged; the next call switches). `upTracker` forwards `detectView: (v, o) => t.detectView(v, o)` and `warm: (m, d) => t.warm(m, d)`; the fakes gain both (Interfaces), and so do the `Tracker` literals of `upFrame.test.ts` (`tsconfig.json` type-checks tests).

- [x] **Step 4: Run to verify they pass**

Run: `cd /d/GitSource/MonaLisa && npx vitest run src/tracking src/geometry src/app && npm run typecheck`
Expected: PASS (the existing "the camera never carries a model" test at `:588` still passes: the VIDEO default is `'camera'`).

- [x] **Step 5: Commit** (CRLF check on `tracker.ts`, `types.ts`, `testFakes.ts`)

```bash
cd /d/GitSource/MonaLisa && git add src/tracking/tracker.ts src/tracking/tracker.test.ts src/types.ts src/geometry/upFrame.ts src/geometry/upFrame.test.ts src/app/testFakes.ts tests/harness/t7/fakes.ts && git commit -m "camera per-person: tracker runs the photo bundle in VIDEO on request, detects on an OffscreenCanvas, detectView (IMAGE with the live guards), warm(mode, detector)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" | cat
```

---

### Task 6: The group path's views (`liveViews`, pure)

**Files:**
- Modify: `src/config/limits.ts` (append the group-path constants), `src/config/limits.test.ts`
- Create: `src/app/liveViews.ts`, `src/app/liveViews.test.ts`

**Interfaces:**
- Consumes: `FaceDetectorKind` (Task 5), `Facing`, `Rect`, `PxRect`, `Landmarks478`, `MAX_LIVE_FACES`; `centerCropRect` (`ui/imaging.ts:13`) in tests only.
- Produces:
  ```ts
  // limits.ts
  export const LIVE_GROUP = true;
  export const LIVE_DETECTOR: Record<Facing, FaceDetectorKind> = { user: 'camera', environment: 'photo' };
  export const LIVE_FACE_FLOOR: Record<Facing, number> = { user: 0.05, environment: 0.03 };
  export const DETECTOR_FLOOR: Record<FaceDetectorKind, number> = { camera: 0.11, photo: 0.08 };
  export const LIVE_SCAN_EVERY = 4;
  export const LIVE_SOLO_AFTER_MS = 5000;
  export const LIVE_VIEW_MAX_EDGE = 1280;
  // app/liveViews.ts
  export interface LiveView { id: string /* 'whole' | `t${col},${row}` */; kind: 'whole' | 'tile'; rect: PxRect; copy: { w: number; h: number } }
  export interface ViewLayout { frame: { w: number; h: number }; crop: PxRect; detector: FaceDetectorKind; whole: LiveView; tiles: readonly LiveView[] }
  export interface DetectScope { name: string; view: Rect /* stream UV */; matchable(pred: Rect): boolean; missable(pred: Rect): boolean }
  export function layoutViews(frameW: number, frameH: number, crop: PxRect, facing: Facing, detector: FaceDetectorKind): ViewLayout;
  export function holdsWhole(view: LiveView, box: Rect, layout: ViewLayout): boolean;
  export function isLarge(box: Rect, layout: ViewLayout): boolean;
  export function tileFor(box: Rect, layout: ViewLayout): LiveView | null;
  export function refreshViews(layout: ViewLayout, boxes: readonly Rect[]): LiveView[];
  export function viewScope(view: LiveView, layout: ViewLayout): DetectScope;
  export function mapLandmarks(lm: Landmarks478, rect: PxRect, frameW: number, frameH: number): Landmarks478;
  export class ViewSchedule { next(layout: ViewLayout, refresh: readonly LiveView[], tracked: number): LiveView; reset(): void }
  ```

- [x] **Step 1: Write the failing tests** (`src/app/liveViews.test.ts`)

```ts
import { describe, expect, it } from 'vitest';
import { DETECTOR_FLOOR, LIVE_VIEW_MAX_EDGE, MAX_LIVE_FACES } from '../config/limits';
import { centerCropRect } from '../ui/imaging';
import { holdsWhole, isLarge, layoutViews, mapLandmarks, refreshViews, tileFor, viewScope, ViewSchedule } from './liveViews';

const crop = (w: number, h: number, ratio: number) => {
  const r = centerCropRect(w, h, ratio);
  return { x: r.x, y: r.y, w: r.width, h: r.height };
};
const R = { '3:4': 3 / 4, '1:1': 1, '9:16': 9 / 16 } as const;

describe('layoutViews (§6.6)', () => {
  it.each([
    ['environment', 'photo', '3:4', 720, 2, 3],
    ['environment', 'photo', '9:16', 720, 2, 4],
    ['environment', 'photo', '1:1', 720, 2, 2],
    ['user', 'camera', '3:4', 873, 2, 2],
    ['user', 'camera', '1:1', 873, 2, 2],
    ['user', 'camera', '9:16', 873, 2, 3],
  ] as const)('%s / %s, %s of the upright 1080 × 1920 stream: %i px tiles, %i × %i', (facing, det, ratio, side, cols, rows) => {
    const c = crop(1080, 1920, R[ratio]);
    const l = layoutViews(1080, 1920, c, facing, det);
    expect(l.whole.rect).toEqual(c);
    expect(l.tiles).toHaveLength(cols * rows);
    expect(l.tiles[0].id).toBe('t0,0');
    expect(l.tiles.at(-1)!.id).toBe(`t${cols - 1},${rows - 1}`);
    for (const t of l.tiles) {
      expect(Math.abs(t.rect.w - side)).toBeLessThanOrEqual(1);
      expect(t.rect.w).toBe(t.rect.h);
      expect(t.copy).toEqual({ w: t.rect.w, h: t.rect.h });
      expect(t.rect.x >= c.x && t.rect.y >= c.y && t.rect.x + t.rect.w <= c.x + c.w && t.rect.y + t.rect.h <= c.y + c.h).toBe(true);
    }
    // neighbours overlap by at least DETECTOR_FLOOR × the crop's long edge, along both axes
    const min = DETECTOR_FLOOR[det] * Math.max(c.w, c.h);
    for (const axis of ['x', 'y'] as const) {
      const starts = [...new Set(l.tiles.map((t) => t.rect[axis]))].sort((a, b) => a - b);
      starts.slice(1).forEach((s, i) => expect(starts[i] + l.tiles[0].rect.w - s).toBeGreaterThanOrEqual(min - 1));
    }
  });
  it('the e2e fake camera (1280 × 720, 3:4 crop 540 × 720) uses the same fractions: front 1 × 2 tiles of 540, back 2 × 2 of 480', () => {
    const c = crop(1280, 720, 3 / 4);
    expect(layoutViews(1280, 720, c, 'user', 'camera').tiles.map((t) => t.rect.w)).toEqual([540, 540]);
    expect(layoutViews(1280, 720, c, 'environment', 'photo').tiles).toHaveLength(4);
  });
  it('the whole view copies at most LIVE_VIEW_MAX_EDGE on its long edge', () => {
    const l = layoutViews(1080, 1920, crop(1080, 1920, 9 / 16), 'environment', 'photo');
    expect(Math.max(l.whole.copy.w, l.whole.copy.h)).toBe(LIVE_VIEW_MAX_EDGE);
  });
});

describe('assignment, scope and mapping (§6.6)', () => {
  const l = layoutViews(1080, 1920, crop(1080, 1920, 3 / 4), 'environment', 'photo'); // crop 1080 × 1440 at y 240
  const box = (cx: number, cy: number, w: number) => ({ x: cx - w / 2, y: cy - (w * 1080) / 1920 / 2, w, h: (w * 1080) / 1920 });
  it('large at ≥ 1.25 × DETECTOR_FLOOR × the crop long edge (144 px); a small box goes to the tile holding it whole with the nearest centre', () => {
    expect(isLarge(box(0.5, 0.5, 145 / 1080), l)).toBe(true);
    expect(isLarge(box(0.5, 0.5, 143 / 1080), l)).toBe(false);
    const small = box(0.2, 0.2, 0.05);
    expect(tileFor(small, l)!.id).toBe('t0,0');
    expect(refreshViews(l, [small, box(0.5, 0.5, 0.2)]).map((v) => v.id)).toEqual(['whole', 't0,0']);
  });
  it('a tile misses only what it holds whole; the whole view misses large tracks and tracks no tile holds (out of the crop)', () => {
    const t00 = l.tiles[0];
    const small = box(0.2, 0.2, 0.05);
    expect(viewScope(t00, l).missable(small)).toBe(true);
    expect(viewScope(l.whole, l).missable(small)).toBe(false);
    expect(viewScope(l.whole, l).matchable(small)).toBe(true);
    expect(viewScope(l.whole, l).missable(box(0.5, 0.5, 0.2))).toBe(true);
    expect(viewScope(l.whole, l).missable(box(0.5, 0.05, 0.05))).toBe(true); // above the crop
    expect(holdsWhole(t00, box(0.6, 0.5, 0.05), l)).toBe(false);
  });
  it('mapLandmarks: view-normalized x, y → stream UV by the rect; z scaled by the rect width over the frame width', () => {
    const lm = { points: new Float32Array(478 * 3) };
    lm.points.set([0.5, 0.5, 0.1], 0);
    const m = mapLandmarks(lm, { x: 360, y: 480, w: 720, h: 720 }, 1080, 1920);
    expect(Array.from(m.points.slice(0, 3))).toEqual([expect.closeTo(720 / 1080, 6), expect.closeTo(840 / 1920, 6), expect.closeTo(0.1 * 720 / 1080, 6)]);
  });
});

describe('ViewSchedule (§6.6)', () => {
  const l = layoutViews(1080, 1920, crop(1080, 1920, 3 / 4), 'environment', 'photo'); // 6 tiles
  const ids = (s: ViewSchedule, refresh: string[], tracked: number, n: number) =>
    Array.from({ length: n }, () => s.next(l, refresh.map((id) => (id === 'whole' ? l.whole : l.tiles.find((t) => t.id === id)!)), tracked).id);
  it('the whole view in every cycle; every 4th call scans the next tile in raster order that is not a refresh view', () => {
    expect(ids(new ViewSchedule(), ['whole'], 2, 8)).toEqual(['whole', 'whole', 'whole', 't0,0', 'whole', 'whole', 'whole', 't1,0']);
    expect(ids(new ViewSchedule(), ['whole', 't0,0'], 3, 8)).toEqual(['whole', 't0,0', 'whole', 't1,0', 't0,0', 'whole', 't0,0', 't0,1']);
  });
  it(`no scans while MAX_LIVE_FACES (${MAX_LIVE_FACES}) faces are tracked: ten far faces over two tiles run a cycle of three views`, () => {
    expect(ids(new ViewSchedule(), ['whole', 't0,0', 't1,1'], MAX_LIVE_FACES, 6)).toEqual(['whole', 't0,0', 't1,1', 'whole', 't0,0', 't1,1']);
  });
});
```

- [x] **Step 2: Run to verify they fail**

Run: `cd /d/GitSource/MonaLisa && npx vitest run src/app/liveViews.test.ts`
Expected: FAIL — `Cannot find module './liveViews'`.

- [x] **Step 3: Implement**

`layoutViews`: `side = min(round(LIVE_FACE_FLOOR[facing] / DETECTOR_FLOOR[detector] × max(frameW, frameH)), min(crop.w, crop.h))`, `overlap = DETECTOR_FLOOR[detector] × max(crop.w, crop.h)`. Per axis of length `L`: `n = side >= L ? 1 : max(2, ceil((L − overlap) / (side − overlap)))`, positions `round(i × (L − side) / (n − 1))` from the crop's origin (`n = 1` → 0); tiles row-major (`t${col},${row}`), copied at native size. Whole: `rect = crop`, `copy` = crop scaled by `min(1, LIVE_VIEW_MAX_EDGE / max(crop.w, crop.h))`, rounded. `holdsWhole` compares the box in frame px with the rect. `isLarge`: `box.w × frame.w ≥ 1.25 × DETECTOR_FLOOR[detector] × max(crop.w, crop.h)`. `tileFor`: among tiles holding the box whole, the nearest centre. `refreshViews`: `[whole, …tiles (raster order) that are tileFor of a small box]`. `viewScope`: tile → matchable = missable = holds whole; whole → matchable = holds whole, missable = `isLarge(pred) || !tiles.some(holds whole)`. `ViewSchedule.next`: call count `c` (from 1); when `c % LIVE_SCAN_EVERY === 0`, `tracked < MAX_LIVE_FACES` and some tile is not a refresh view, return the next such tile in raster order after the last scanned one (wrapping); otherwise the refresh view after the last refresh view returned (by id in list order, wrapping; the first call returns `refresh[0]`). `mapLandmarks`: `x' = (rect.x + x · rect.w) / frameW`, `y' = (rect.y + y · rect.h) / frameH`, `z' = z · rect.w / frameW`, into a new `Float32Array`.

- [x] **Step 4: Run to verify they pass**

Run: `cd /d/GitSource/MonaLisa && npx vitest run src/app/liveViews.test.ts src/config && npm run typecheck`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
cd /d/GitSource/MonaLisa && git add src/config src/app/liveViews.ts src/app/liveViews.test.ts && git commit -m "camera per-person: the group path's views (whole view and zoomed tiles of the visible crop), assignment, schedule and mapping" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" | cat
```

---

### Task 7: The detection cadence (`liveCore`, pure)

**Files:**
- Modify: `src/config/limits.ts` (append `LIVE_MIN_FPS`, `LIVE_MAX_DETECT_EVERY`), `src/app/liveCore.ts` (after `:143`), `src/app/liveCore.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const LIVE_MIN_FPS = 24;          // limits.ts
  export const LIVE_MAX_DETECT_EVERY = 6;  // limits.ts
  export const CADENCE_UP_MS = 500;        // liveCore.ts
  export const CADENCE_DOWN_MS = 1500;     // liveCore.ts
  export function detectEvery(detectMs: number, renderMs: number, frameMs: number): number;
  export class DetectCadence { get k(): number; update(nowMs: number, detectMs: number | null, renderMs: number | null, frameMs: number): number; reset(): void }
  export function effectiveEvery(k: number, tier: Tier, shownFaces: number): number;
  export function cadenceSample(renderMs: number, detectMs: number, every: number): number;
  ```

- [x] **Step 1: Write the failing tests** (`liveCore.test.ts`)

```ts
describe('detection cadence (camera per-person spec §6.4, K6)', () => {
  const T = 1000 / 30;
  it('detectEvery: k = clamp(⌈(D + R − T) / (T_min − T)⌉, 1, 6), T_min = max(1000 / 24, 1.25 T)', () => {
    expect(detectEvery(30, 5, T)).toBe(1);   // front, 3 faces
    expect(detectEvery(64, 5, T)).toBe(5);   // back, 10 faces, GPU
    expect(detectEvery(82, 5, T)).toBe(6);   // CPU (7, clamped)
    expect(detectEvery(5, 3, T)).toBe(1);
    expect(detectEvery(64, 5, 66.7)).toBe(1);  // a 15 fps camera: T_min = 1.25 T
    expect(detectEvery(120, 5, 66.7)).toBe(4);
  });
  it('DetectCadence: a rising k applies after 500 ms, a falling one after 1500 ms; reset → 1', () => {
    const c = new DetectCadence();
    expect(c.update(0, 64, 5, T)).toBe(1);
    expect(c.update(499, 64, 5, T)).toBe(1);
    expect(c.update(500, 64, 5, T)).toBe(5);
    expect(c.update(600, 20, 5, T)).toBe(5);
    expect(c.update(2099, 20, 5, T)).toBe(5);
    expect(c.update(2100, 20, 5, T)).toBe(1);
    expect(c.update(2200, null, null, T)).toBe(1);
    c.update(2300, 64, 5, T);
    c.update(2800, 64, 5, T);
    c.reset();
    expect(c.k).toBe(1);
  });
  it('effectiveEvery: one face or none → every frame (tier L: every second, as v0.5); ≥ 2 faces → max(k, tier L ? 2 : 1)', () => {
    expect([effectiveEvery(4, 'H', 1), effectiveEvery(4, 'H', 0), effectiveEvery(4, 'L', 1)]).toEqual([1, 1, 2]);
    expect([effectiveEvery(5, 'L', 2), effectiveEvery(1, 'L', 2), effectiveEvery(1, 'M', 3)]).toEqual([5, 2, 1]);
  });
  it('the auto-tier sample of a detecting frame at k > 1 is R + D / k', () => {
    expect(cadenceSample(5, 64, 5)).toBeCloseTo(17.8, 6);
    expect(cadenceSample(5, 64, 1)).toBe(69);
  });
});
```

- [x] **Step 2: Run to verify they fail** — `npx vitest run src/app/liveCore.test.ts` → FAIL (`detectEvery` not exported).

- [x] **Step 3: Implement** — `detectEvery` is the formula of the test name (`Tmin = max(1000 / LIVE_MIN_FPS, 1.25 × frameMs)`; a non-finite input or `Tmin ≤ frameMs` → 1). `DetectCadence.update`: with a `null` D or R the candidate is the current `k`; a candidate different from `k` starts a timer (restarted when the candidate's direction changes) and is applied once it held `CADENCE_UP_MS` (rising) or `CADENCE_DOWN_MS` (falling). `effectiveEvery` and `cadenceSample` as the tests state.

- [x] **Step 4: Run to verify they pass** — `npx vitest run src/app/liveCore.test.ts src/config && npm run typecheck` → PASS.

- [x] **Step 5: Commit**

```bash
cd /d/GitSource/MonaLisa && git add src/config src/app/liveCore.ts src/app/liveCore.test.ts && git commit -m "camera per-person: the detection cadence (≥ 24 fps on average, face updates ≥ 5 Hz) with its hysteresis" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" | cat
```

---

### Task 8: The live loop runs the group path, the cadence and the forced capture detection

**Files:**
- Modify: `src/app/faceTracks.ts` (`detect` gains `scope`; `presentCount()`)
- Modify: `src/app/live.ts` (`LiveDeps.group`; per-stream path and detector; the per-frame detection; capture; stats and debug) — CRLF
- Modify: `src/types.ts:822-871` (`DebugState.liveEvery`, `liveDetector`, `livePath`, `liveViews`) — CRLF
- Modify: `src/store/settings.ts` (live debug knob), `src/ui/deps.ts:14, :76` — CRLF
- Modify: `src/ui/screens/Camera.tsx:140-150, :180-192, :286-290` (group option, warm-up) — CRLF
- Modify: `tests/harness/t7/fakes.ts:247` (its `LiveStats` literal gains `path: 'solo', every: 1`; the file is type-checked, `tsconfig.json` includes `tests`)
- Test: `src/app/faceTracks.test.ts`, `src/app/live.test.ts`, `src/store/settings.test.ts`

**Interfaces:**
- Consumes: Task 5 `detectVideo(…, { detector })`, `detectView(view, { maxFaces, detector })`, `warm`, the fakes' `detectView`; Task 6 `layoutViews`, `refreshViews`, `viewScope`, `mapLandmarks`, `ViewSchedule`, `DetectScope`, `LIVE_*` constants; Task 7 `DetectCadence`, `effectiveEvery`, `cadenceSample`.
- Produces:
  ```ts
  // faceTracks.ts
  detect(lms: readonly Landmarks478[] | null, tsMs: number, w: number, h: number, scope?: DetectScope): void;
  presentCount(): number;
  // live.ts
  interface LiveDeps { …; /** the group path (§6.6); default LIVE_GROUP */ group?: boolean }
  interface LiveStats { …; path: 'solo' | 'group'; every: number }
  // settings.ts
  export const LIVE_DEBUG_KEY = 'meiyan.debug.live.v1';
  export function readLiveDebug(): { group?: boolean }; // e2e knob, works in the production build; never throws
  // types.ts DebugState
  liveEvery?: number; liveDetector?: 'short-range' | 'full-range'; livePath?: 'solo' | 'group'; liveViews?: string[];
  ```

- [x] **Step 1: Write the failing tests**

`faceTracks.test.ts`:

```ts
describe('FaceTracks on the group path: a call matches and misses only what its view holds (§6.6)', () => {
  const scope = (x0: number, x1: number): DetectScope => {
    const inside = (b: Rect) => b.x >= x0 && b.x + b.w <= x1;
    return { name: 'tile', view: { x: x0, y: 0, w: x1 - x0, h: 1 }, matchable: inside, missable: inside };
  };
  it('a call whose view does not hold a track neither misses nor ages it', () => {
    const t = new FaceTracks(editedAll());
    run(t, 5, () => [A(), B()]);
    for (let i = 0, now = 200; i < 60; i++, now += 33) {
      t.detect([A()], now, W, H, scope(0, 0.5));
      t.step(33, now);
    }
    expect(t.views()).toHaveLength(2);
    expect(t.views().find((v) => v.box.x > 0.5)!.present).toBe(true);
    expect(t.views().find((v) => v.box.x < 0.5)!.view).toBe('tile');
  });
  it('a track missed by a view that holds it is held, then dropped', () => {
    const t = new FaceTracks(editedAll());
    run(t, 5, () => [A(), B()]);
    for (let i = 0, now = 200; i < 40; i++, now += 33) {
      t.detect([A()], now, W, H, scope(0, 1));
      t.step(33, now);
    }
    expect(t.views()).toHaveLength(1);
  });
  it('a face cut by the view edge starts no track unless it matches one', () => {
    const t = new FaceTracks(new LivePersons());
    t.detect([lmAt(0.5, 0.5, 0.2)], 0, W, H, scope(0, 0.55));
    expect(t.views()).toHaveLength(0);
  });
});
```

`live.test.ts`: `setup()` gains `facing?: Facing`, `frame?: () => Rect` (passed as `getFrame`), `group?: boolean`, `fullRange?: boolean` (sets `tracker.photoDetector = 'full-range'` before the loop starts). Task 3's "Review Focus #1" test now calls `setup({ persons, group: false })`: its back-camera stream then stays on VIDEO, where the fake answers faces (the session is what it checks; the group path's own back-camera start is the first test below). The two older tests that switch to `facing: 'environment'` (`:104-117`, `:450-462`) keep the group path: without an `OffscreenCanvas` stub its view copy throws inside the guarded call and answers null (Step 4), so they still pass. Imports added: `EDIT_DETECT_FACES`, `LIVE_DETECT_FACES`, `LIVE_SOLO_AFTER_MS`, `LOST_HOLD_MS` from `../config/limits`, `normalizedCropRect` from `../ui/imaging`, `type FakeTracker` from `./testFakes`, `type Facing` from `../types`. New helpers and describe (the `adapt` mock is switched to `makeFace(++faceSeq, lm.points[0])` for this describe and restored afterwards, as the `gpLeftOnLeft` test does at `:548-575`; a face is then a 0.4 × 0.4 box centred at `(points[0], 0.5)`):

```ts
/** OffscreenCanvas stand-in: drawImage records the source rect the loop copied */
class FakeView {
  src = [0, 0, 0, 0];
  constructor(public width: number, public height: number) {}
  getContext() {
    return { drawImage: (_v: unknown, sx: number, sy: number, sw: number, sh: number) => void (this.src = [sx, sy, sw, sh]) };
  }
}
const lmX = (x: number) => { const l = makeLandmarks(); l.points[0] = x; return l; };
/** a detectView that sees the faces at stream x `xs()` (boxes x ± 0.2, y 0.3–0.7) whose box lies inside the copied view */
function viewDetect(t: FakeTracker, xs: () => readonly number[], clock?: { work(ms: number): void }, cost = 0, W = 1280, H = 720) {
  t.detectView.mockImplementation((img) => {
    clock?.work(cost);
    const [sx, sy, sw, sh] = (img as unknown as FakeView).src;
    return xs()
      .filter((x) => (x - 0.2) * W >= sx && (x + 0.2) * W <= sx + sw && 0.3 * H >= sy && 0.7 * H <= sy + sh)
      .map((x) => lmX((x * W - sx) / sw));
  });
}
const whole = (): Rect => ({ x: 0, y: 0, w: 1, h: 1 });

describe('the group path in the live loop (§6.3, §6.4, §6.6, K13, K18)', () => {
  let xs: number[];
  let orig: typeof adapt | undefined;
  beforeEach(() => {
    vi.stubGlobal('OffscreenCanvas', FakeView);
    orig = vi.mocked(adapt).getMockImplementation();
    vi.mocked(adapt).mockImplementation((lm) => makeFace(++faceSeq, lm.points[0])); // a 0.4 × 0.4 face centred at (points[0], 0.5)
    xs = [0.25, 0.75];
  });
  afterEach(() => {
    vi.mocked(adapt).mockImplementation(orig!);
  });
  it('the back camera starts on the group path: IMAGE calls on the views at EDIT_DETECT_FACES with the full-range detector', () => {
    const { tracker, loop } = setup({ facing: 'environment', frame: whole, fullRange: true });
    viewDetect(tracker!, () => xs);
    vi.advanceTimersByTime(1000);
    expect(tracker!.detectVideo).not.toHaveBeenCalled();
    expect(tracker!.detectView.mock.calls[0][0]).toBeInstanceOf(FakeView);
    expect(tracker!.detectView.mock.calls[0][1]).toEqual({ maxFaces: EDIT_DETECT_FACES, detector: 'photo' });
    expect(dbg()).toMatchObject({ livePath: 'group', liveDetector: 'full-range' });
    expect(dbg()!.liveViews![0]).toBe('whole');
    expect(loop.tracks()).toHaveLength(2);
    loop.stop();
  });
  it('the front camera: solo until a second face, then group; solo again LIVE_SOLO_AFTER_MS after the group thins to one; persons carry over', () => {
    const { tracker, loop } = setup({ frame: whole });
    xs = [0.25];
    tracker!.detectVideo.mockImplementation(() => xs.map(lmX));
    viewDetect(tracker!, () => xs);
    vi.advanceTimersByTime(500);
    expect([dbg()!.livePath, tracker!.detectView.mock.calls.length]).toEqual(['solo', 0]);
    const p = loop.tracks()[0].person;
    xs = [0.25, 0.75];
    vi.advanceTimersByTime(100);
    expect(dbg()!.livePath).toBe('group');
    expect(loop.tracks().some((t) => t.person === p)).toBe(true);
    xs = [0.25];
    vi.advanceTimersByTime(LIVE_SOLO_AFTER_MS + 500); // the 0.75 track drops after LOST_HOLD_MS, then the 5 s count
    expect(dbg()!.livePath).toBe('group');
    vi.advanceTimersByTime(1100);
    expect(dbg()!.livePath).toBe('solo');
    expect(loop.tracks().map((t) => t.person)).toEqual([p]);
    loop.stop();
  });
  it('one face never leaves the solo path (A1): detectVideo every frame with the camera bundle, never detectView', () => {
    const { tracker, loop } = setup();
    vi.advanceTimersByTime(33 * 300 + 1);
    expect(tracker!.detectVideo).toHaveBeenCalledTimes(300);
    expect(tracker!.detectVideo.mock.calls.every((c) => c[2].detector === 'camera' && c[2].maxFaces === LIVE_DETECT_FACES)).toBe(true);
    expect(tracker!.detectView).not.toHaveBeenCalled();
    loop.stop();
  });
  it('LIVE_GROUP off (deps.group false): option C, VIDEO on every facing with LIVE_DETECTOR’s bundle', () => {
    const back = setup({ facing: 'environment', group: false, fullRange: true });
    vi.advanceTimersByTime(200);
    expect(back.tracker!.detectVideo.mock.calls.at(-1)![2]).toEqual({ maxFaces: LIVE_DETECT_FACES, detector: 'photo' });
    expect(back.tracker!.detectView).not.toHaveBeenCalled();
    back.loop.stop();
    back.video.halt();
    const front = setup({ group: false });
    vi.advanceTimersByTime(200);
    expect(front.tracker!.detectVideo.mock.calls.at(-1)![2]).toEqual({ maxFaces: LIVE_DETECT_FACES, detector: 'camera' });
    front.loop.stop();
  });
  it('the detector is fixed per stream session: a full-range download landing mid-stream is used from the next session', () => {
    const { tracker, camera, loop } = setup({ facing: 'environment', frame: whole });
    viewDetect(tracker!, () => xs);
    vi.advanceTimersByTime(200);
    expect(tracker!.detectView.mock.calls.at(-1)![1].detector).toBe('camera');
    tracker!.photoDetector = 'full-range';
    vi.advanceTimersByTime(200);
    expect(tracker!.detectView.mock.calls.at(-1)![1].detector).toBe('camera');
    camera.set({ state: 'interrupted' });
    camera.set({ state: 'live' });
    vi.advanceTimersByTime(200);
    expect(tracker!.detectView.mock.calls.at(-1)![1].detector).toBe('photo');
    loop.stop();
  });
  it('cadence: two faces and a 64 ms detection skip frames (every 5 at R 5 ms); one face detects every frame', () => {
    const { tracker, engine, clock, loop } = setup({ facing: 'environment', frame: whole });
    viewDetect(tracker!, () => xs, clock, 64);
    engine.cost = 5;
    vi.advanceTimersByTime(3000);
    expect(dbg()!.liveEvery).toBe(5);
    const n = tracker!.detectView.mock.calls.length;
    vi.advanceTimersByTime(33 * 50);
    expect(tracker!.detectView.mock.calls.length - n).toBe(10);
    xs = [0.5];
    vi.advanceTimersByTime(2000);
    expect(dbg()!.liveEvery).toBe(1);
    loop.stop();
  });
  it('K13: capture detects first when the last detection is older than the captured frame; on the group path, every refresh view', () => {
    const solo = setup({ prefs: { tier: 'L' } });
    vi.advanceTimersByTime(33 * 12 + 1); // frame 12 does not detect on tier L
    const n = solo.tracker!.detectVideo.mock.calls.length;
    solo.loop.capture();
    expect(solo.tracker!.detectVideo.mock.calls.length).toBe(n + 1);
    solo.loop.stop();
    solo.video.halt();
    const group = setup({ facing: 'environment', frame: whole });
    viewDetect(group.tracker!, () => xs);
    vi.advanceTimersByTime(500);
    group.video.currentTime += 1 / 30; // a frame newer than the last detection
    const m = group.tracker!.detectView.mock.calls.length;
    group.loop.capture();
    expect(group.tracker!.detectView.mock.calls.length - m).toBe(dbg()!.liveViews!.length);
    group.loop.stop();
  });
  it('Review Focus #2: a ratio change on the group path drops the faces outside the new crop within LOST_HOLD_MS and keeps the others', () => {
    let frame = whole();
    const { tracker, loop } = setup({ facing: 'environment', frame: () => frame });
    xs = [0.25, 0.5];
    viewDetect(tracker!, () => xs);
    vi.advanceTimersByTime(500);
    const keep = loop.tracks().find((t) => Math.abs(t.box.x + t.box.w / 2 - 0.5) < 0.02)!.person;
    frame = normalizedCropRect(1280, 720, 3 / 4); // x 0.289–0.711: the 0.25 face is cut, the 0.5 face inside
    vi.advanceTimersByTime(LOST_HOLD_MS + 300);
    expect(loop.tracks().map((t) => t.person)).toEqual([keep]);
    loop.stop();
  });
  it('Review Focus #4: an IMAGE call that throws, then no answer (null: an instance being replaced, the rebuild throttle), holds every track, person and the pin; drawing goes on; detection resumes on the same persons', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { tracker, engine, loop } = setup({ facing: 'environment', frame: whole });
    viewDetect(tracker!, () => xs);
    vi.advanceTimersByTime(500);
    const before = loop.tracks().map((t) => t.person).sort();
    loop.select(before[1]);
    tracker!.detectView.mockImplementation(() => {
      throw new Error('graph');
    });
    const r = engine.render.mock.calls.length;
    vi.advanceTimersByTime(2000);
    expect(engine.render.mock.calls.length - r).toBeGreaterThanOrEqual(60);
    expect(loop.tracks().map((t) => t.person).sort()).toEqual(before);
    expect(loop.selection()).toBe(before[1]);
    tracker!.detectView.mockImplementation(() => null);
    vi.advanceTimersByTime(2000);
    expect(loop.tracks().map((t) => t.person).sort()).toEqual(before);
    expect(loop.selection()).toBe(before[1]);
    viewDetect(tracker!, () => xs);
    vi.advanceTimersByTime(300);
    expect(loop.tracks().map((t) => t.person).sort()).toEqual(before);
    expect(loop.tracks().every((t) => t.present)).toBe(true);
    loop.stop();
  });
});
```

`settings.test.ts`: `readLiveDebug()` reads `{ group: false }` from `meiyan.debug.live.v1`, `{}` for junk or no storage.

- [x] **Step 2: Run to verify they fail** — `npx vitest run src/app/faceTracks.test.ts src/app/live.test.ts src/store/settings.test.ts` → FAIL (no scope, no group path).

- [x] **Step 3: Implement the scope in `FaceTracks.detect`**

With a `scope`: candidate tracks for every matching rule are those whose predicted box is `scope.matchable`; after matching, a free track is set `present = false` only when `scope.missable(predicted)`; an unmatched, uncontinued detection whose box is not inside `scope.view` whole starts nothing. Every refreshed track records `view = scope?.name ?? 'video'`. `presentCount()` counts present tracks.

- [x] **Step 4: Implement the paths in `live.ts`**

Per stream session (in `resetSession`): `detector = tracker && LIVE_DETECTOR[facing] === 'photo' && tracker.photoDetector === 'full-range' ? 'photo' : 'camera'`; `group = (deps.group ?? LIVE_GROUP) && MAX_LIVE_FACES > 1` (`MAX_LIVE_FACES = 1` still means 選臉 hidden, the smoother bypassed and no group path, §6.3); `path = group && facing === 'environment' ? 'group' : 'solo'`; `cadence.reset()`, `schedule.reset()`, `soloSince = null`, `sinceDetect = Infinity`. The layout is memoized on `w × h`, the crop in px (`deps.getFrame?.()` × w, h, rounded; the whole frame without it), `facing`, `detector`.

Each frame (replacing `:175-184`):

```ts
const shown = tracks.views().length;
const every = effectiveEvery(cadence.k, engine.tier, shown);
let detected = false;
if (tracker && sinceDetect + 1 >= every) {
  const t0 = performance.now();
  if (path === 'solo') {
    tracks.detect(detectVideo(tracker), now, w, h); // { maxFaces: LIVE_DETECT_FACES, detector }
    // only found tracks the visible crop holds whole count (§6.6): VIDEO sees the whole frame, the group path only the crop
    if (group && facing === 'user' && tracks.presentCount() >= 2 && presentInView(layout) >= 2) { path = 'group'; schedule.reset(); }
  } else {
    groupCall(tracker, now, w, h);                  // schedule.next → copy the view → detectView → mapLandmarks → tracks.detect(…, viewScope)
    if (facing === 'user') {
      if (tracks.views().length <= 1) { soloSince ??= now; if (now - soloSince >= LIVE_SOLO_AFTER_MS) path = 'solo'; }
      else soloSince = null;
    }
  }
  detectMs = performance.now() - t0;
  detected = true; sinceDetect = 0; lastDetectMedia = video.currentTime;
} else sinceDetect++;
tracks.step(interval ?? 0, now);
```

`groupCall`'s refresh list is `refreshViews(layout, tracks.views().map((v) => tracks.predicted(v.id, now)!))`; the copy is a 2D `drawImage(video, rect.x, rect.y, rect.w, rect.h, 0, 0, copy.w, copy.h)` into one reused `OffscreenCanvas` per copy size (an `HTMLCanvasElement` when `OffscreenCanvas` is missing), then `tracker.detectView(copy, { maxFaces: EDIT_DETECT_FACES, detector })`. The copy and the call share one `try`: a throw anywhere in them (no canvas to be had, `drawImage`, `detectView`) is reported (`reportError('live detect', …)`) and fed to `tracks.detect` as `null`, as is a `null` answer (A5: no aging, no drop, the pin kept); only an array is mapped (`mapLandmarks(lm, view.rect, w, h)`) and fed with `viewScope(view, layout)`. After drawing: `cameraEma.update(interval)` when neither this frame nor the previous one detected (start `1000 / 30`); `cadence.update(now, detectEma.value, renderEma.value, cameraEma.value ?? 1000 / 30)`; the auto-tier sample of a detecting frame with `every > 1` is `cadenceSample(renderMs, detectMs, every)` without the skipped-frames charge (`:199-202` otherwise unchanged). `capture()` first runs, when `tracker && video.currentTime !== lastDetectMedia`, one solo detection or every view of the current refresh list (no scans), through the same guarded calls, then `tracks.step(0, capNow)`. `capNow` stays on the frame clock the tracks run on (`FrameInfo.now`; the tests' fake video runs it on `Date.now()`, not `performance.now()`): `capNow = lastTs + max(1, (video.currentTime − lastMedia) × 1000)`, `lastMedia` being `video.currentTime` at the last processed frame. Stats and debug: `LiveStats.path / every`, `dbg.liveEvery = every`, `dbg.liveDetector = detector === 'photo' ? 'full-range' : 'short-range'`, `dbg.livePath`, `dbg.liveViews` (the refresh list's ids, `[]` on the solo path).

- [x] **Step 5: Implement the knob and the Camera warm-up**

`settings.ts`: `LIVE_DEBUG_KEY`, `readLiveDebug()` as `readExportDebug` (`:255-264`) does; `deps.ts` exposes it. `Camera.tsx`: the loop gets `group: LIVE_GROUP && deps.readLiveDebug().group !== false`; a helper `warmFor(f: Facing)` calls `bundle?.tracker?.warm(group && f === 'environment' ? 'IMAGE' : 'VIDEO', LIVE_DETECTOR[f])` inside try/catch; `flip()` computes the next facing, calls `endCameraSession()`, `ctrl.flip()`, then schedules `warmFor(next)` once the spinner has painted (`requestAnimationFrame(() => setTimeout(() => warmFor(next), 0))`): the warm-up blocks the main thread (the full-range compile, 1.1–1.3 s on the desktop GPU, §6.1) while `getUserMedia` opens the stream behind 「正在開啟相機…」; a synchronous call inside the tap would freeze the old preview before the spinner shows. When the stream wins the race, the first group-path call pays the compile and the warm-up finds the graph switched (one blank inference). `start()` schedules `warmFor('environment')` the same way after `ctrl.start(…)` when the facing is `'environment'`.

- [x] **Step 6: Run to verify they pass**

Run: `cd /d/GitSource/MonaLisa && npx vitest run src/app src/store src/ui && npm run typecheck`
Expected: PASS (the existing tier-L tests still see every second detection with one face).

- [x] **Step 7: Commit** (CRLF check on `live.ts`, `types.ts`, `deps.ts`, `Camera.tsx`)

```bash
cd /d/GitSource/MonaLisa && git add src/app/faceTracks.ts src/app/faceTracks.test.ts src/app/live.ts src/app/live.test.ts src/types.ts src/store/settings.ts src/store/settings.test.ts src/ui/deps.ts src/ui/screens/Camera.tsx tests/harness/t7/fakes.ts && git commit -m "camera per-person: the group path (IMAGE calls on fixed views), the cadence, the detector per stream session, the capture's forced detection, the flip warm-up" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" | cat
```

---

### Task 9: Brackets on every face, the dot on the target, dimming, the one-time hint

**Files:**
- Modify: `src/ui/components/CameraFaceMarker.tsx` (`:13-69` nodes, `:71-128` component), `src/ui/components/CameraFaceMarker.test.tsx`
- Modify: `src/ui/theme.css:2717-2750` (`.cam-bracket`, `.cam-marker.dim`) — CRLF
- Modify: `src/store/settings.ts:169-179` (hint), `src/store/settings.test.ts`
- Modify: `src/ui/screens/Camera.tsx:128-138, :396-404` — CRLF
- Modify: `tests/e2e/camera-group.spec.ts:31-44` (the marker's node count)

**Interfaces:**
- Produces:
  ```ts
  // CameraFaceMarker props: { loop; canvas; video; mirrored; ring: { person: LivePersonId; at: number } | null; all: boolean; count: number; dim: boolean }
  // settings.ts
  export const CAM_PERSONS_HINT_KEY = 'meiyan.hint.camPersons.v1';
  export function takeCameraPersonsHint(): boolean; // true once per install (as takePersonsHint, :174-179)
  ```

- [x] **Step 1: Write the failing tests** (`CameraFaceMarker.test.tsx`)

```ts
it('brackets: one node per shown face while ≥ 2 are shown and 全部套用 is off, kept across frames, removed with its track', () => {
  const views = { current: [view(1, 0.1, true), view(2, 0.6, false), view(3, 0.35, false)] };
  const { marker } = mount(views, null);
  frame();
  const brackets = shown(marker, 'cam-bracket');
  expect(brackets).toHaveLength(3);
  expect(brackets[0].style).toMatchObject({ left: '30px', top: '120px', width: '60px', height: '120px' });
  const made = created;
  for (let i = 0; i < 10; i++) frame();
  expect(created).toBe(made);
  views.current = views.current.slice(0, 2);
  frame();
  expect(shown(marker, 'cam-bracket')).toHaveLength(2);
  expect(shown(marker, 'cam-dot')).toHaveLength(1);
});
it('no brackets with one face or under 全部套用 (no dot either); dim puts the layer at 30 %', () => {
  const one = mount({ current: [view(1, 0.1, true)] }, null);
  frame();
  expect(shown(one.marker, 'cam-bracket')).toHaveLength(0);
  const all = mount({ current: [view(1, 0.1, true), view(2, 0.6, false)] }, null, true);
  frame();
  expect([shown(all.marker, 'cam-bracket').length, shown(all.marker, 'cam-dot').length]).toEqual([0, 0]);
  // Preact sets `class` as an attribute on this DOM stand-in (FakeElement has no `class` property)
  expect(all.marker.getAttribute('class')).toBe('cam-marker');
  const dimmed = mount({ current: [view(1, 0.1, true), view(2, 0.6, false)] }, null, false, true);
  frame();
  expect(dimmed.marker.getAttribute('class')).toBe('cam-marker dim');
  expect(shown(dimmed.marker, 'cam-bracket')).toHaveLength(2);
});
```

`mount(views, ring, all = false, dim = false)` passes `dim={dim}` (the prop is required), and its `rerender` keeps it.

`settings.test.ts`: `takeCameraPersonsHint()` is true once, then false; false when storage drops writes.

- [x] **Step 2: Run to verify they fail** — `npx vitest run src/ui/components/CameraFaceMarker.test.tsx src/store/settings.test.ts` → FAIL.

- [x] **Step 3: Implement**

`MarkerNodes` gains `showBrackets(boxes: Map<TrackId, PxBox> | null)`: one `<i class="cam-bracket">` per track id holding four corner `<i class="br tl|tr|bl|br-r">` children made once, styles written through `set()` (only on change), nodes of vanished ids removed, all hidden when `null`. Brackets show while `views.length >= 2 && !all`; the rAF loop keeps running while brackets, the dot or the ring show (`:121`). The root is `<div class={\`cam-marker${dim ? ' dim' : ''}\`}>`. CSS: `.cam-bracket` is the editor's `.face-box` corner shape (`theme.css:2668-2687`) at `opacity: .4`; `.cam-marker.dim { opacity: .3 }`. `Camera.tsx`: `dim={photoScoped(sel, lensOf(look))}`; in `onStats`, the first time `s.faces >= 2` in this mount, `if (takeCameraPersonsHint()) toast('點選畫面中的臉，可個別調整', 3200)`.

- [x] **Step 4: Update `camera-group.spec.ts:31-44`**: the marker holds one dot plus one bracket per face: `expect(marker).toEqual({ nodes: 4, most: 4, dots: 1 })`.

*As executed:* the existing marker test "keeps one dot node…" now expects 2 style writes when face 1 moves (the dot's `left` and its bracket's `left`), not 1. The corner rules are shared (`.face-box .br, .cam-bracket .br`, and the four corner selectors) rather than copied; `.cam-marker` gains the editor layer's `transition: opacity 200ms`. `Camera.tsx` passes `dim={photoScoped(sel, lens)}` (the render's `lens`, the same value as `lensOf(look)` after `keepDrag`) and asks for the hint once per mount (a `sawGroup` ref). `camera-group.spec.ts` also checks the hint toast (recorded by a `MutationObserver`, as `crop.spec.ts` does), the marker undimmed on 美膚 › 磨皮 and dimmed on 美膚 › 銳化; each new check was seen failing on a build without the `Camera.tsx` wiring.

- [x] **Step 5: Run** — `npx vitest run src/ui src/store && npm run typecheck && npm run build && npx playwright test tests/e2e/camera-group.spec.ts --project chromium-group` → PASS.

- [x] **Step 6: Commit** (CRLF check on `theme.css`, `Camera.tsx`)

```bash
cd /d/GitSource/MonaLisa && git add src/ui/components/CameraFaceMarker.tsx src/ui/components/CameraFaceMarker.test.tsx src/ui/theme.css src/store/settings.ts src/store/settings.test.ts src/ui/screens/Camera.tsx tests/e2e/camera-group.spec.ts && git commit -m "camera per-person: faint brackets on every face, the dot on the target, dimming on photo items, the one-time hint" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" | cat
```

---

### Task 10: The hand-over, camera side

**Files:**
- Modify: `src/types.ts:286-292` (`CameraHandOver`) — CRLF
- Modify: `src/ui/imaging.ts` (after `shotSeed`, `:79-85`), `src/ui/imaging.frame.test.ts`
- Modify: `src/edit/sides.ts` (after `splitOff`, `:40-46`), `src/edit/sides.test.ts`
- Modify: `src/edit/migrate.ts` (after `importEdit`, `:125-127`), `src/edit/migrate.test.ts`
- Modify: `src/ui/state.ts:19-28, :30-59` — CRLF; `src/ui/flows.ts:18-20` — CRLF
- Modify: `src/ui/screens/Camera.tsx:224-250` — CRLF; `src/ui/screens/Review.tsx:87-96` — CRLF
- Modify (review fix): `tests/e2e/adjust.spec.ts:240-311` (`:239-310` before the fix; changed on purpose, U6, §3.8, §12.2): its camera test sets 暗角 100, 顆粒 100 and 質感 CCD, so the shot hands that photo look over; after 編輯 it expects 暗角 and 顆粒 at 100, the 調節 tab dot, 質感 CCD selected, and keeps the reload check of `meiyan.look.v1`

**Interfaces:**
- Consumes: Task 3 `LiveLoop.capture().persons`; Task 1 `isNeutralPerson`, `isNeutralPhoto`.
- Produces:
  ```ts
  // types.ts
  export interface CameraHandOver { photo: PhotoParams; persons: readonly { box: Rect; params: PersonParams }[]; ambient: PersonParams | null }
  // ui/imaging.ts
  export function shotBox(box: Rect, vw: number, vh: number, ratio: number, mirrored: boolean): Rect;   // shotSeed's crop; mirrored x' = 1 − x' − w'; unclamped
  export function shotPersons(persons: readonly { rawBox: Rect; params: PersonParams }[], vw: number, vh: number, ratio: number, mirrored: boolean): { box: Rect; params: PersonParams }[];
  // edit/sides.ts
  export function mirrorSides(p: PersonParams): PersonParams;  // restored from 03698fc (removed in 4728133)
  // edit/migrate.ts
  export function handOverOf(photo: PhotoParams, persons: readonly { box: Rect; params: PersonParams }[], ambient: PersonParams | null): CameraHandOver | null;
  export function handOverEdit(h: CameraHandOver): EditState;
  // ui/state.ts
  interface Shot { …; handOver: CameraHandOver | null }
  interface EditorSource { …; handOver?: CameraHandOver['persons'] | null }
  // ui/flows.ts
  export function freshSource(bitmap, edit, returnTo, faceSeed: FaceSeed = null, handOver: CameraHandOver['persons'] | null = null): EditorSource;
  ```

- [x] **Step 1: Write the failing tests**

`sides.test.ts`: restore the deleted test verbatim (`git show 94b76ce:src/edit/sides.test.ts`, "mirrorSides swaps exactly the six split ids and is an involution").

`imaging.frame.test.ts` (import `shotBox`, `shotPersons` from `./imaging`, `mirrorSides`, `splitOn`, `writeSide` from `../edit/sides`, `naturalPerson` from `../edit/state`):

```ts
it('shotBox: video UV → the saved 3:4 crop of 1280 × 720 (x 370, 540 wide), mirrored as saved, not clamped', () => {
  const b = { x: 0.5, y: 0.25, w: 0.1, h: 0.2 };
  expect(shotBox(b, 1280, 720, 3 / 4, false)).toEqual({ x: 0.5, y: 0.25, w: expect.closeTo(128 / 540, 9), h: 0.2 });
  expect(shotBox(b, 1280, 720, 3 / 4, true).x).toBeCloseTo(1 - 0.5 - 128 / 540, 9);
  expect(shotBox({ x: 0, y: 0.25, w: 0.1, h: 0.2 }, 1280, 720, 3 / 4, false).x).toBeCloseTo(-370 / 540, 9);
});
it('Review Focus #5: a mirrored shot hands over mirrored boxes and swapped sides; a person outside the picture is not handed over', () => {
  const split = writeSide(splitOn(naturalPerson()), 'shape.faceSlim', 0.9, 'right');
  const out = shotPersons(
    [{ rawBox: { x: 0.45, y: 0.3, w: 0.1, h: 0.2 }, params: split }, { rawBox: { x: 0.05, y: 0.3, w: 0.08, h: 0.15 }, params: naturalPerson() }],
    1280, 720, 3 / 4, true,
  );
  expect(out).toHaveLength(1);
  expect(out[0].params).toEqual(mirrorSides(split));
  expect(out[0].box.x).toBeCloseTo(1 - (0.45 * 1280 - 370) / 540 - 128 / 540, 9);
});
```

`migrate.test.ts`:

```ts
describe('the camera hand-over (camera per-person spec §3.8, §5.3)', () => {
  const box = { x: 0.4, y: 0.3, w: 0.2, h: 0.2 };
  it('handOverOf: null when nothing is set; otherwise the photo look, the edited persons and the ambient person', () => {
    expect(handOverOf(neutralPhoto(), [], null)).toBeNull();
    expect(handOverOf({ ...neutralPhoto(), presetLink: null }, [], neutralPerson())).toBeNull();
    expect(handOverOf(defaultPhoto(), [], null)).toEqual({ photo: defaultPhoto(), persons: [], ambient: null });
    expect(handOverOf(neutralPhoto(), [{ box, params: naturalPerson() }], null)?.persons).toEqual([{ box, params: naturalPerson() }]);
    expect(handOverOf(neutralPhoto(), [], naturalPerson())?.ambient).toEqual(naturalPerson());
  });
  it('handOverEdit: the camera photo look from the first frame, p0 the ambient person or 原圖, template 原圖', () => {
    const e = handOverEdit({ photo: defaultPhoto(), persons: [{ box, params: naturalPerson() }], ambient: null });
    expect(e).toEqual({ v: 2, photo: defaultPhoto(), persons: { p0: neutralPerson() }, template: neutralPerson(), primaryInit: null });
    expect(handOverEdit({ photo: neutralPhoto(), persons: [], ambient: naturalPerson() }).persons.p0).toEqual(naturalPerson());
  });
});
```

- [x] **Step 2: Run to verify they fail** — `npx vitest run src/edit/sides.test.ts src/ui/imaging.frame.test.ts src/edit/migrate.test.ts` → FAIL.

- [x] **Step 3: Implement**

`mirrorSides` from the removed code (`git show 94b76ce:src/edit/sides.ts`, the function after `splitOff`). `shotBox` uses `centerCropRect` as `shotSeed` does. `shotPersons` maps each box, swaps sides when mirrored, and keeps only boxes whose centre lies in `[0, 1]²`. `handOverOf` returns `null` when `persons` is empty, `isNeutralPhoto(photo)` and (`ambient` null or `isNeutralPerson(ambient)`); else `{ photo, persons, ambient: ambient && !isNeutralPerson(ambient) ? ambient : null }`. `handOverEdit(h) = { v: 2, photo: sanitizePhoto(h.photo), persons: { [P0]: h.ambient ?? neutralPerson() }, template: neutralPerson(), primaryInit: null }`. `Camera.tsx` `captureFrom`: `const handOver = handOverOf(lookRef.current.photo, shotPersons(shotOut.persons, vw, vh, ratioValue, mirror), bundle?.basic ? cameraSession().ambient : null)`, stored on the `Shot`. `Review.tsx` `edit()`: `freshSource(shot.original, shot.handOver ? handOverEdit(shot.handOver) : importEdit(), 'camera', shot.faceSeed, shot.handOver?.persons ?? null)`; its comment cites U6. `freshSource` stores `handOver`.

- [x] **Step 4: Run** — `npx vitest run src/edit src/ui && npm run typecheck` → PASS.

- [x] **Step 5: Commit** (CRLF check on `types.ts`, `state.ts`, `flows.ts`, `Camera.tsx`, `Review.tsx`)

```bash
cd /d/GitSource/MonaLisa && git add src/types.ts src/ui/imaging.ts src/ui/imaging.frame.test.ts src/edit/sides.ts src/edit/sides.test.ts src/edit/migrate.ts src/edit/migrate.test.ts src/ui/state.ts src/ui/flows.ts src/ui/screens/Camera.tsx src/ui/screens/Review.tsx && git commit -m "camera per-person: the shot carries the hand-over (photo look, each edited person's box and params, mirrored as saved); 編輯 opens with the camera photo look" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" | cat
```

---

### Task 11: The hand-over, editor side (match, zoomed retry, toast)

**Files:**
- Modify: `src/config/limits.ts` (`HANDOVER_ZOOM_FACE`)
- Modify: `src/detect/persons.ts` (after `seedPrimary`, `:113-126`), `src/detect/persons.test.ts`
- Modify: `src/edit/migrate.ts:129-157` (`AnswerInput.handOver`, `Answer.handOverMissed`), `:223-310` (`firstAnswer`), `src/edit/migrate.test.ts`
- Modify: `src/app/still.ts:135-155` (`StillSessionOptions.handOver`), `:170-173`, `:502-552` (`detectFaces`, `detectOnce`), `src/app/still.test.ts`
- Modify: `src/ui/screens/Editor.tsx:735-739, :813-836`
- Modify: `tests/e2e/original.spec.ts:156-249` (the camera hand-over test split in two)

**Interfaces:**
- Consumes: Task 10 `CameraHandOver`, `EditorSource.handOver`; Task 6 `mapLandmarks`; Task 5 `detectImage(OffscreenCanvas)`.
- Produces:
  ```ts
  export const HANDOVER_ZOOM_FACE = 0.25; // limits.ts
  // detect/persons.ts
  export function matchHandOver(boxes: readonly Rect[], faces: readonly { id: string; box: Rect }[]): { pairs: readonly [number, string][]; missed: number };
  // edit/migrate.ts
  interface AnswerInput { …; /** first answer only, as faceSeed */ handOver?: CameraHandOver['persons'] | null }
  interface Answer { …; handOverMissed?: number }
  // app/still.ts
  interface StillSessionOptions { …; /** the camera persons' boxes (O-space), for the photo's first answer only */ handOver?: readonly Rect[] | null }
  export function zoomCrop(box: Rect, width: number, height: number): PxRect; // side min(long edge, box.w × width / HANDOVER_ZOOM_FACE), centred, moved inside, clipped to the image
  ```

- [x] **Step 1: Write the failing tests**

`persons.test.ts`:

```ts
describe('matchHandOver (camera per-person spec §5.4, K14)', () => {
  const f = (id: string, x: number) => ({ id, box: { x, y: 0.3, w: 0.1, h: 0.12 } });
  const faces = [f('f0', 0.1), f('f1', 0.4), f('f2', 0.7)];
  it('pairs by IoU ≥ 0.3 (best first), then by the padded centre (nearest first), one to one; the rest are missed', () => {
    const r = matchHandOver([{ x: 0.11, y: 0.3, w: 0.1, h: 0.12 }, { x: 0.43, y: 0.33, w: 0.04, h: 0.05 }, { x: 0.9, y: 0.3, w: 0.05, h: 0.06 }], faces);
    expect(r).toEqual({ pairs: [[0, 'f0'], [1, 'f1']], missed: 1 });
  });
  it('two camera persons on one face: the better IoU takes it, the other is missed, never given another face', () => {
    const r = matchHandOver([{ x: 0.42, y: 0.3, w: 0.1, h: 0.12 }, { x: 0.4, y: 0.3, w: 0.1, h: 0.12 }], faces);
    expect(r).toEqual({ pairs: [[1, 'f1']], missed: 1 });
  });
  it('ties keep the input order (boxes, then faces)', () => {
    const r = matchHandOver([{ x: 0.1, y: 0.3, w: 0.1, h: 0.12 }], [f('a', 0.1), f('b', 0.1)]);
    expect(r.pairs).toEqual([[0, 'a']]);
  });
});
```

`migrate.test.ts` (inside the `firstAnswer` describe, reusing `two`, `base`, `lmAt`; `f0` at x 0.3 (w 0.2), `f1` at 0.7 (w 0.12) of 1000 × 1000):

```ts
describe('firstAnswer with a camera hand-over (camera per-person spec §5.4)', () => {
  const at = (cx: number, w: number) => ({ x: cx - w / 2, y: 0.4 - w / 2, w, h: w });
  const nat = naturalPerson();
  const ref = personFromPreset('refined', 1);
  const opened = handOverEdit({ photo: defaultPhoto(), persons: [], ambient: null });
  it('each matched face takes its camera person’s params; the seed names the primary; an unmatched person is counted', () => {
    const a = firstAnswer({ ...base, prepared: two, faceSeed: { x: 0.7, y: 0.4 }, handOver: [{ box: at(0.3, 0.2), params: nat }, { box: at(0.71, 0.1), params: ref }, { box: at(0.95, 0.05), params: nat }] });
    const e = a.rebase(opened);
    expect([a.detect.primary, e.persons.f0, e.persons.f1, a.handOverMissed]).toEqual(['f1', nat, ref, 1]);
    expect(e.photo).toEqual(defaultPhoto());
  });
  it('an edit made before the answer (p0 ≠ the template) stays with the primary; the others still take theirs', () => {
    const touched = withPersons(opened, ['p0'], (p) => ({ ...p, values: { ...p.values, 'skin.smooth': 0.8 }, preset: 'custom' }));
    const a = firstAnswer({ ...base, prepared: two, faceSeed: { x: 0.7, y: 0.4 }, handOver: [{ box: at(0.3, 0.2), params: nat }, { box: at(0.71, 0.1), params: ref }] });
    const e = a.rebase(touched);
    expect(e.persons.f1.values['skin.smooth']).toBe(0.8);
    expect(e.persons.f0).toEqual(nat);
  });
  it('no face in the answer: every camera person is missed, p0 stays as the edit opened', () => {
    const a = firstAnswer({ ...base, prepared: prepareFaces([], 1000, 1000), handOver: [{ box: at(0.3, 0.2), params: nat }] });
    expect(a.handOverMissed).toBe(1);
    expect(a.rebase(opened).persons).toEqual({ p0: neutralPerson() });
  });
  it('a camera box on an obstacle (a face the cap dropped) matches nothing; every undo state takes the same mapping', () => {
    const eleven = prepareFaces(Array.from({ length: 11 }, (_, i) => lmAt(0.05 + i * 0.09, 0.5, i === 10 ? 0.05 : 0.07)), 1000, 1000);
    expect(eleven.obstacles).toHaveLength(1);
    const a = firstAnswer({ ...base, prepared: eleven, handOver: [{ box: eleven.obstacles[0].box, params: nat }, { box: eleven.faces[0].box, params: ref }] });
    expect(a.handOverMissed).toBe(1);
    const older = withPersons(opened, ['p0'], (p) => ({ ...p, values: { ...p.values, 'skin.smooth': 0.3 }, preset: 'custom' }));
    const owner = a.detect.persons.find((p) => p.face === eleven.faces[0].id)!.id;
    expect(a.rebase(opened).persons[owner]).toEqual(ref);
    expect(Object.keys(a.rebase(older).persons)).toEqual(Object.keys(a.rebase(opened).persons));
  });
});
```

`still.test.ts` (new describe; a local `adapt` mock, `(l, w, h) => { const f = makeFace(0, l.points[0]); for (i < 36) { f.oval[2i] = l.points[0] + l.points[2]·cos; f.oval[2i+1] = l.points[1] + l.points[2]·(w / h)·sin } return f; }`, places a face at `(lm0.x, lm0.y)` with radius `lm0.z` (a fraction of the width), so `mapLandmarks` moves it like a real face, and is restored in `afterEach` as the D2 describe does at `:828-830`; `OffscreenCanvas` stubbed with `class { constructor(public width: number, public height: number) {} getContext() { return { drawImage: vi.fn() }; } }`; `bitmap()` is 1536 × 2048):

```ts
describe('createStillSession: the hand-over retries (camera per-person spec §5.4, K21)', () => {
  const face = (x: number, y: number, r: number) => { const l = makeLandmarks(); l.points.set([x, y, r], 0); return l; };
  const far = { x: 0.59375, y: 0.3, w: 0.0625, h: 0.046875 }; // 96 px wide, centre x 960 px
  const xs = (s: StillSession) => s.faces.map((f) => f.box.x + f.box.w / 2);
  it('a box no full-range face holds gets one full-range detection on a crop of side box width / 0.25; the face holding its centre joins', () => {
    const bmp = bitmap();
    const tracker = fakeTracker();
    tracker.photoDetector = 'full-range';
    tracker.detectImage.mockImplementation((img) => (img === bmp ? [face(0.25, 0.5, 0.15)] : [face(0.5, 0.5, 0.125)]));
    const s = createStillSession(fakeEngine(), tracker, bmp, { handOver: [far] });
    const crop = tracker.detectImage.mock.calls[1][0] as unknown as { width: number; height: number };
    expect([crop.width, crop.height]).toEqual([384, 384]);
    expect(tracker.detectImage.mock.calls[1][1]).toEqual({ maxFaces: EDIT_DETECT_FACES });
    expect(xs(s)).toEqual([expect.closeTo(0.25, 6), expect.closeTo(0.625, 6)]);
  });
  it('zoomCrop moves the crop inside the image at an edge', () => {
    expect(zoomCrop({ x: 0.97, y: 0.97, w: 0.02, h: 0.015 }, 1536, 2048)).toEqual({ x: 1536 - 123, y: 2048 - 123, w: 123, h: 123 });
  });
  it('a box over a quarter of the long edge and the faceSeed share one short-range pass (the crop would be the whole image)', () => {
    const bmp = bitmap();
    const tracker = fakeTracker();
    tracker.photoDetector = 'full-range';
    tracker.detectImage.mockImplementation((_img, o) => (o.detector === 'camera' ? [face(0.25, 0.5, 0.15), face(0.75, 0.5, 0.2)] : [face(0.25, 0.5, 0.15)]));
    const big = { x: 0.55, y: 0.4, w: 0.4, h: 0.3 }; // 614 px ≥ 0.25 × 2048
    const s = createStillSession(fakeEngine(), tracker, bmp, { handOver: [big], faceSeed: { x: 0.75, y: 0.5 } });
    expect(tracker.detectImage.mock.calls.map((c) => c[1])).toEqual([{ maxFaces: EDIT_DETECT_FACES }, { maxFaces: EDIT_DETECT_FACES, detector: 'camera' }]);
    expect(xs(s)).toEqual([expect.closeTo(0.25, 6), expect.closeTo(0.75, 6)]);
  });
  it('nothing more runs when every seed is found; a box its zoomed retry misses is left out (firstAnswer counts it)', () => {
    const bmp = bitmap();
    const found = fakeTracker();
    found.photoDetector = 'full-range';
    found.detectImage.mockImplementation(() => [face(0.25, 0.5, 0.15)]);
    createStillSession(fakeEngine(), found, bmp, { handOver: [{ x: 0.2, y: 0.45, w: 0.1, h: 0.075 }] });
    expect(found.detectImage).toHaveBeenCalledTimes(1);
    const missed = fakeTracker();
    missed.photoDetector = 'full-range';
    missed.detectImage.mockImplementation((img) => (img === bmp ? [face(0.25, 0.5, 0.15)] : []));
    const s = createStillSession(fakeEngine(), missed, bmp, { handOver: [far] });
    expect(missed.detectImage).toHaveBeenCalledTimes(2);
    expect(xs(s)).toEqual([expect.closeTo(0.25, 6)]);
  });
});
```

- [x] **Step 2: Run to verify they fail** — `npx vitest run src/detect/persons.test.ts src/edit/migrate.test.ts src/app/still.test.ts` → FAIL.

- [x] **Step 3: Implement `matchHandOver` and the `firstAnswer` hand-over**

`matchHandOver`: candidate pairs `(i, face)` with `boxIoU ≥ 0.3`, sorted by IoU descending (stable), taken greedily one to one; then for the boxes left, every unused face whose box padded by `SEED_BOX_PAD` holds the box centre, sorted by centre distance ascending (stable), greedily; `missed = boxes.length − pairs.length`. `firstAnswer`: when `a.handOver?.length`, compute `matchHandOver(a.handOver.map((p) => p.box), cache.faces)` once; `camera: Record<PersonId, PersonParams>` maps each paired face's owner (`cache.persons.find((p) => p.face === faceId)`) to the params. Inside `rebase`, after `assignPersons` and the A13 hand-over (on both of its `return` paths), apply `withPersons(result, ids, (_, id) => camera[id])` to every `camera` id, except the primary when the user edited before this answer: `p0Edited = stableKey({ ...p0, preset: null }) !== stableKey({ ...template, preset: null })` with `p0 = out.persons[P0] ?? out.template` (§5.4 item 2: `assignPersons` already gave the primary `p0`). `Answer.handOverMissed = missed` (`a.handOver.length` when the answer has no face).

- [x] **Step 4: Implement the retries in `still.ts`**

`detectOnce(tracker, bitmap, w, h, seed, boxes)`; `createStillSession` passes `opts.handOver ?? []`. The rule, replacing `detectFaces` (`:515-539`):

```ts
const raw = tracker.detectImage(bitmap, { maxFaces: EDIT_DETECT_FACES });
let base = raw;
let first = prepareFaces(raw, width, height);
const detector = tracker.photoDetector;
if (detector !== 'full-range') return { prepared: first, detector };
const centre = (b: Rect) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const long = Math.max(width, height);
const missed = (pt: { x: number; y: number }) => seedPrimary(pt, first.faces) === null;
let short: Landmarks478[] | null = null;           // one shared short-range pass at most
const runShort = () => (short ??= tracker.detectImage(bitmap, { maxFaces: EDIT_DETECT_FACES, detector: 'camera' }));
// 1. no usable face: today's retry, its answer taken whole when it has faces (a throw propagates: detectOnce reports the answer unsure, known false, as today)
if (!first.faces.length) { const r = prepareFaces(runShort(), width, height); if (r.faces.length) { base = short!; first = r; } }
// 2. the seeds still missed: the point, the big boxes (crop = the whole image) → the shared short-range pass; small boxes → a zoomed full-range crop each
const held: PreparedFace[] = [];
const big = boxes.filter((b) => missed(centre(b)) && b.w * width >= HANDOVER_ZOOM_FACE * long);
const small = boxes.filter((b) => missed(centre(b)) && b.w * width < HANDOVER_ZOOM_FACE * long);
const pointMissed = !!seed && first.faces.length > 0 && missed(seed);
if (pointMissed || big.length) {
  const r = prepareFaces(runShort(), width, height).faces;      // a throw keeps the answer (today's :526-534 rule)
  for (const pt of [...(pointMissed ? [seed!] : []), ...big.map(centre)]) for (const f of r) if (seedPrimary(pt, [f]) !== null && !held.includes(f)) held.push(f); // each face once
}
for (const b of small) {
  const crop = zoomCrop(b, width, height);
  const found = prepareFaces(tracker.detectImage(cropCanvas(bitmap, crop), { maxFaces: EDIT_DETECT_FACES }).map((l) => mapLandmarks(l, crop, width, height)), width, height).faces;
  const hit = found.filter((f) => seedPrimary(centre(b), [f]) !== null);  // a throw: that box stays missed, reported
  if (hit.length) held.push(hit.reduce((x, y) => (dist(x, b) <= dist(y, b) ? x : y)));
}
return { prepared: held.length ? prepareWith(base, held, width, height) : first, detector };
```

`dbg.detectRetries` counts one per answer that ran any retry. `cropCanvas(bitmap, r)` draws the rect into an `OffscreenCanvas(r.w, r.h)` (a document canvas without it). `zoomCrop`: `side = round(min(long, b.w × width / HANDOVER_ZOOM_FACE))`, `w = min(side, width)`, `h = min(side, height)`, `x = clamp(round(cx·width − side / 2), 0, width − w)`, likewise `y`.

- [x] **Step 5: Wire the editor**

`Editor.tsx:815`: `handOver: !useCache && !answered.current ? (source.handOver?.map((p) => p.box) ?? null) : null` beside `faceSeed`; `:831`: `handOver: first ? (source.handOver ?? null) : null`; `applyAnswer` (`:735-739`) pushes `` `${a.handOverMissed} 位人物在照片中未偵測到臉部，未帶入相機效果` `` to `notices` when `first && a.handOverMissed`.

(Executed with one adaptation, 2026-10-20: the no-face toast (`Editor.tsx:848`, 「未偵測到臉部，臉型、美妝與膚質工具不會套用」) was shown right after `applyAnswer` and took the one toast slot (`state.ts` `toast`), so with no face in the photo it overwrote the hand-over's toast at once (§11 "Editor finds no face … toast with n"). It now leads the answer's notices (`applyAnswer(a, first, lead)`), same condition and timing, and the notices after it follow 3.4 s apart.)

- [x] **Step 6: Run the unit tests** — `npx vitest run src/detect src/edit src/app src/ui && npm run typecheck` → PASS.

- [x] **Step 7: Update `original.spec.ts`'s camera test (changed on purpose, §12.2)**

Split it: (a) **nothing set** — open the camera, change nothing, shoot, 編輯: `passes` `['composite']`, export MAD 0 against `__shotOriginal` (today's assertions); (b) **a camera look** — 一鍵 › 自然 and 美白 100 as today, the preview and the capture differ from the frame (today's assertions), then 編輯: the first answer's person at the face has `磨皮` equal to 自然's (read the 美膚 › 磨皮 slider), `美白` reads 100, and `passes` include more than `composite`. Add (c) **reload**: `STYLED_LOOK` stored, open the camera: `passes` of the live frame never include `mask`, `makeup` or `reshape` (the stored person part is not applied, K15).

- [x] **Step 8: Run** — `npm run build && npx playwright test tests/e2e/original.spec.ts tests/e2e/camera.spec.ts --project chromium && npx playwright test tests/e2e/camera-group.spec.ts --project chromium-group` → PASS.

- [x] **Step 9: Commit**

```bash
cd /d/GitSource/MonaLisa && git add src/config src/detect/persons.ts src/detect/persons.test.ts src/edit/migrate.ts src/edit/migrate.test.ts src/app/still.ts src/app/still.test.ts src/ui/screens/Editor.tsx tests/e2e/original.spec.ts && git commit -m "camera per-person: 編輯 gives each person found their camera params (IoU, padded centre, zoomed retry), drops the rest with a notice" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" | cat
```

---

### Task 12: The upright clips, `group10.y4m`, `group_move.y4m` and their Playwright projects

**Files:**
- Modify: `scripts/gen-y4m.mjs` (layouts, `composeCells`, the move timeline, JPEG decode, CLI `--layout`, `--move`; `main` becomes async), `scripts/gen-group-fixture.mjs:127-144` (export `launch`)
- Modify: `tests/harness/t5/group-fixtures.test.mjs` (layout and timeline checks)
- Modify: `tests/e2e/global-setup.ts:19-33`, `playwright.config.ts:35-64`, `LICENSES/NOTICE.txt:80`
- Modify: `tests/e2e/fixtures.ts` (`uprightCamera(page)`, `cpuDelegate(page: Page, delegate: string = 'CPU')`, `camBox(page, id, mirrored = true): Promise<{ point: { x; y }; rect: Rect }>`: today's `camGeom` at `camera-group.spec.ts:7-23`, renamed and given the `mirrored` flag; that spec then imports it)

**Interfaces:**
- Produces (gen-y4m.mjs):
  ```js
  /** a face layout on an upright frame: fw = face width as a fraction of the long edge; cx, cy fractions of width, height */
  export const UPRIGHT_ROW3 = { width: 1080, height: 1920, faces: [/* 3 × { fw: 0.065, cx: (540 ± 2.7·125) / 1080, cy: 0.5, mirror } */] };
  export const UPRIGHT_FAR10 = { width: 1080, height: 1920, faces: [/* 2 rows × 5, fw 0.030–0.034 (back) / 0.035–0.040 (front), centres 2.7 FW apart, rows 1.6 face heights apart, around (0.5, 0.5) */] };
  export const SELFIE_GROUP = { width: 1080, height: 1920, faces: [/* near: fw 0.14 at (0.135, 0.68), 0.16 at (0.85, 0.68) (centres 2.68 widths apart, both whole); back row: fw 0.06, 0.07, 0.08 at x (540 ∓ 363) / 1080 and 0.5, cy 0.45 */] };
  export function composeCells(png, layout, seed): Float32Array;   // sample_face.png cells (GROUP6.crop, 1.3 FW squares) at seeded sub-pixel offsets in [0, 1) px
  export function composeFitWidthBoxes(layout): { x: number; y: number; w: number; h: number }[]; // a gen-group-fixture layout's face boxes in frame UV after composeFitWidth (scale to 1280, bottom-aligned)
  export const MOVE = { width: 640, height: 360, seconds: 18 };
  export function moveAt(t: number): { A: {x, y}, B: {x, y}, C: { x, y } | null, cBehind: boolean }; // the timeline below, px
  ```
  Clips: `upright_row3.y4m`, `upright_far10.y4m`, `selfie_group.y4m` (8 static frames each, about 25 MB), `group10.y4m` (`--src tests/fixtures/ten_faces.jpg`, `composeFitWidth`, 30 frames), `group_move.y4m` (`--move`, 540 frames, about 187 MB). All gitignored (`.gitignore` already has `tests/fixtures/*.y4m`).
  `group_move` timeline (deviation from §12.3, recorded in Task 16: the spec's 16 s clip ends with B standing where C starts, so its loop seam would hand B's track to C; this one returns to its first frame): 0–2 s still (A, B, C at `GROUP_CAM` × 0.5); 2–3.5 s C removed; 3.5–5.5 s C back at +0.2 FW; 5.5–7 s B and C swap (about 1.1 C face widths per second, C drawn behind B, hidden ~0.3 s); 7–8.5 s still; 8.5–10 s swap back the same way; 10–11 s still; 11–16.5 s C removed (5.5 s, over `REID_GRACE_MS`); 16.5–18 s still. ±0.5 px of seeded shift per frame on every face.

- [x] **Step 1: Write the failing tests** (`group-fixtures.test.mjs`, new describe `upright and move clips (camera per-person spec §12.3)`)

```js
const FH = 722 / 619; // sample_face.png's face height over its width (SAMPLE_FACE, the oval box)
const px = (f) => ({ x: f.cx * 1080, y: f.cy * 1920, w: f.fw * 1920 });
const inCrop34 = (f) => { const p = px(f); return p.x - p.w / 2 >= 0 && p.x + p.w / 2 <= 1080 && p.y - (p.w * FH) / 2 >= 240 && p.y + (p.w * FH) / 2 <= 1680; };
const rowsOf = (L) => [...new Set(L.faces.map((f) => f.cy))].sort((a, b) => a - b).map((cy) => L.faces.filter((f) => f.cy === cy).sort((a, b) => a.cx - b.cx));
const gaps = (row) => row.slice(1).map((f, i) => (px(f).x - px(row[i]).x) / ((px(f).w + px(row[i]).w) / 2));

it('UPRIGHT_ROW3: three faces at 6.5 % of the long edge (125 px), centres 2.7 FW apart, at mid-height, inside the 3:4 crop', () => {
  expect(UPRIGHT_ROW3.faces.map((f) => Math.round(px(f).w))).toEqual([125, 125, 125]);
  expect(gaps(rowsOf(UPRIGHT_ROW3)[0]).map((g) => +g.toFixed(1))).toEqual([2.7, 2.7]);
  expect(UPRIGHT_ROW3.faces.every((f) => f.cy === 0.5 && inCrop34(f))).toBe(true);
});
it('UPRIGHT_FAR10: ten faces at 3–4 % (58–77 px) in two rows of five, centres 2.7 FW apart, rows 1.6 face heights apart', () => {
  expect(UPRIGHT_FAR10.faces.every((f) => f.fw >= 0.03 && f.fw <= 0.04 && inCrop34(f))).toBe(true);
  const rows = rowsOf(UPRIGHT_FAR10);
  expect(rows.map((r) => r.length)).toEqual([5, 5]);
  for (const r of rows) for (const g of gaps(r)) expect(g).toBeCloseTo(2.7, 1);
  const fh = (UPRIGHT_FAR10.faces.reduce((s, f) => s + px(f).w, 0) / 10) * FH;
  expect((px(rows[1][0]).y - px(rows[0][0]).y) / fh).toBeCloseTo(1.6, 1);
});
it('SELFIE_GROUP: two near faces at 14 % and 16 % in the lower half, three at 6–8 % in a row behind them, all whole', () => {
  const [back, near] = rowsOf(SELFIE_GROUP);
  expect([near.map((f) => f.fw), back.map((f) => f.fw)]).toEqual([[0.14, 0.16], [0.06, 0.07, 0.08]]);
  expect(near.every((f) => f.cy > 0.5) && back.every((f) => f.cy < near[0].cy)).toBe(true);
  for (const g of [...gaps(near), ...gaps(back)]) expect(g).toBeCloseTo(2.7, 0);
  expect(SELFIE_GROUP.faces.every(inCrop34)).toBe(true);
});
it('composeCells is deterministic for a seed; another seed moves the faces by sub-pixel offsets', () => {
  const png = PNG.sync.read(readFileSync(fx('sample_face.png')));
  const a = composeCells(png, UPRIGHT_ROW3, 1);
  const again = composeCells(png, UPRIGHT_ROW3, 1);
  expect(a.every((v, i) => v === again[i])).toBe(true);
  const b = composeCells(png, UPRIGHT_ROW3, 2);
  let d = 0;
  for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i]));
  expect(d).toBeGreaterThan(0);
});
it('moveAt: C gone 2–3.5 s and 11–16.5 s, back at +0.2 FW at 3.5 s, swapped at 7–8.5 s, home at 10 s; the loop seam is continuous', () => {
  const fwC = groupCamTiles().find((t) => t.name === 'C').fw / 2;
  expect([moveAt(2.5).C, moveAt(12).C, moveAt(16.4).C]).toEqual([null, null, null]);
  expect(moveAt(4).C.x - moveAt(1).C.x).toBeCloseTo(0.2 * fwC, 1);
  expect(moveAt(7.5).C.x).toBeCloseTo(moveAt(1).B.x, 1);
  expect(moveAt(7.5).B.x).toBeCloseTo(moveAt(1).C.x, 1);
  expect(moveAt(10.5)).toEqual(moveAt(0.5));
  expect(moveAt(17.99)).toEqual(moveAt(0));
});
it('composeFitWidthBoxes(TEN_FACES): ten boxes 9–13 % of the frame width, bottom-aligned as composeFitWidth draws them', () => {
  const boxes = composeFitWidthBoxes(TEN_FACES);
  expect(boxes).toHaveLength(10);
  expect(boxes.every((b) => b.w >= 0.09 - 1e-6 && b.w <= 0.13 + 1e-6 && b.y >= 0 && b.y + b.h <= 1)).toBe(true);
});
```

- [x] **Step 2: Run** — `npx vitest run tests/harness/t5/group-fixtures.test.mjs` → FAIL (exports missing).

- [x] **Step 3: Implement the generator**

`composeCells` resamples `GROUP6.crop` of `sample_face.png` into each cell (`size = round(fw · long · crop.w / SAMPLE_FACE.fw)`), shifting the source rect by `offset × crop.w / size` for the sub-pixel placement, mirrored per face, on `backdropColour(png)`. The move clip composes `GROUP_CAM`'s A, B, C tiles (`groupCamTiles()`) at half scale on the photo's background per frame from `moveAt(f / 30)` (C drawn before B, so B covers it), then `shiftFrame` by `rng(seed)` ±0.5 px and `rgbToI420`. JPEG sources decode in headless Chromium through `launch()` (exported from `gen-group-fixture.mjs`; dynamic `import('@playwright/test')` only on that path). CLI: `--layout upright_row3|upright_far10|selfie_group`, `--move`, `--seed <n>`.

- [x] **Step 4: Wire the setup and the projects**

`global-setup.ts`: one stale-checked entry per clip (inputs: `scripts/gen-y4m.mjs`, `scripts/gen-group-fixture.mjs`, and `sample_face.png` / `group_faces.png` / `ten_faces.jpg`). `playwright.config.ts`: `chromium`'s `testIgnore` becomes the RegExp `/camera-(group|persons|groups|back|identity)\.spec\.ts/`; `chromium-group` matches `/camera-(group|persons)\.spec\.ts/`; new projects, each with its own `--use-file-for-fake-video-capture`: `chromium-upright-row3` (`testMatch: 'camera-groups.spec.ts'`, `grep: /@row3/`), `chromium-upright-far10` (`grep: /@far10/`), `chromium-selfie-group` (`grep: /@selfie/`), `chromium-group10` (`camera-back.spec.ts`), `chromium-group-move` (`camera-identity.spec.ts`). `fixtures.ts`: `uprightCamera(page)` (an init script that rewrites `getUserMedia`'s video constraint to `width: { ideal: 1080 }, height: { ideal: 1920 }`), `cpuDelegate(page: Page, delegate: string = 'CPU')` (`meiyan.prefs.v1` `{ delegate }` when unset), `camBox(page, id)` (the client point and frame-relative rect of a debug box, mirrored on the front camera, from `camera-group.spec.ts:7-23`, which now imports it). `NOTICE.txt`: the new clips are modified derivatives of `sample_face.png` (and of `ten_faces.jpg` / `group_faces.png`), generated, not committed.

- [x] **Step 5: Generate and check**

Run: `cd /d/GitSource/MonaLisa && npx vitest run tests/harness/t5/group-fixtures.test.mjs && npm run build && npx playwright test tests/e2e/home.spec.ts --project chromium`
Expected: PASS; `tests/fixtures/` holds the five new clips (global setup printed one line each with its size).

(Executed with these adaptations, 2026-10-20. Added beyond the interfaces above, each with a test: `composeMove(png)` (a moveAt state → the move clip's RGB frame before its shift, so the draw order is tested), `cBehind` true during the two swaps only (C drawn first then; no overlap otherwise), `groupCamTiles(scale = 1)` (the move clip's half scale; unchanged at 1), the exports `LAYOUTS` and `UPRIGHT_FRAMES`, and a NOTICE check that names the five clips. `composeFitWidthBoxes` uses the layout's nominal `fw`, `cx`, `cy`, not the whole-px cell, since the test's 1e-6 bound needs it (a 0.09 face's rounded cell is 0.08996 wide). In global setup `face.y4m` keeps its two inputs, so a change to `gen-group-fixture.mjs` alone does not rebuild it. face.y4m and group.y4m came out byte-identical to the previous build. Global setup printed the upright clips at 24.9 MB each, group10 at 41.5 MB and group_move at 186.6 MB. A throwaway smoke spec, not committed, showed: every clip reaches the page at its size (1080×1920 via `uprightCamera`, 1280×720, 640×360); `cpuDelegate` gives `delegate` CPU; on the front camera `selfie_group` reached 5 faces on the group path within 4 s. On `group_move` (front, CPU, unedited persons) the ids followed B and C through each swap, but when the motion stopped at 7 s two new persons took the final places. The old tracks were held about 22 px behind for under a second, then dropped. This is faceTracks behaviour, not the clip; Task 14's E5 should watch for it.)

- [x] **Step 6: Commit**

```bash
cd /d/GitSource/MonaLisa && git add scripts/gen-y4m.mjs scripts/gen-group-fixture.mjs tests/harness/t5/group-fixtures.test.mjs tests/e2e/global-setup.ts playwright.config.ts tests/e2e/fixtures.ts tests/e2e/camera-group.spec.ts LICENSES/NOTICE.txt && git commit -m "camera per-person: upright group clips, group10 and group_move, and their Playwright projects" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" | cat
```

---

### Task 13: E2E E1–E3 (`camera-persons.spec.ts`, `group.y4m`)

**Files:**
- Create: `tests/e2e/camera-persons.spec.ts`
- Modify: `tests/e2e/fixtures.ts` (move `exportDiff` and its `Diff` out of `original.spec.ts:39-96`, and wrap the init script at `:165-177` as `armShotOriginal(page)` and the comparison at `:218-226` as `capturedVsOriginal(page): Promise<{ same: boolean; mad: number }>`), `tests/e2e/original.spec.ts` (imports them)

**Interfaces:**
- Consumes: `debugState`, `grab`, `hold`, `mad`, `regionDiff`, `dragSlider`, `selectPerson`, `camBox` (`tests/e2e/fixtures.ts`); debug `boxes[].person / edited`, `selected`, `passes` (Tasks 3, 8); the editor's debug `boxes` (face ids) and `selected` (a person id: a face person's id is its face's, `detect/cache.ts:331`).

- [x] **Step 1: Write the tests**

```ts
// E1–E3 (camera per-person spec §12.2) on group.y4m: A above, B and C side by side below (composeGroupCam), front camera.
import type { Page } from '@playwright/test';
import { armShotOriginal, camBox, capturedVsOriginal, debugState, dragSlider, expect, grab, hold, mad, regionDiff, selectPerson, test } from './fixtures';

async function openCamera(page: Page): Promise<{ A: string; B: string; C: string }> {
  await page.goto('/');
  await page.getByRole('button', { name: /拍攝/ }).click();
  await page.getByRole('button', { name: '點擊開啟相機' }).click();
  await expect.poll(async () => (await debugState(page)).faces, { timeout: 120_000, intervals: [500] }).toBe(3);
  await page.addStyleTag({ content: '.cam-marker, .all-chip, .badge, .toast { display: none !important; }' });
  const boxes = (await debugState(page)).boxes;
  const A = [...boxes].sort((a, b) => a.y - b.y)[0].id;
  const [B, C] = boxes.filter((b) => b.id !== A).sort((a, b) => a.x - b.x).map((b) => b.id); // B left of C in the unmirrored frame (x 505 vs 782 px)
  return { A, B, C };
}
const tap = async (page: Page, id: string) => {
  const g = await camBox(page, id);
  await page.mouse.click(g.point.x, g.point.y);
  await expect.poll(async () => (await debugState(page)).selected).toBe(id);
};
const preset = async (page: Page, name: string) => {
  await page.getByRole('tab', { name: '一鍵', exact: true }).click();
  await page.getByRole('option', { name, exact: true }).click();
};
/**
 * 一鍵 › 自然 on the target, then its photo part (美白, 銳化: the whole frame) back to 0, so an untouched face stays 原圖
 * pixel for pixel (camera-group.spec.ts:50-56 does the same). 自然's 濾鏡 is 'none'; 精緻 would set 'soft' on the frame
 */
async function natural(page: Page): Promise<void> {
  await preset(page, '自然');
  await page.getByRole('tab', { name: '美膚', exact: true }).click();
  for (const item of ['美白', '銳化']) {
    await page.getByRole('option', { name: item, exact: true }).click();
    await page.getByRole('slider').focus();
    for (let i = 0; i < 100; i++) await page.keyboard.press('ArrowLeft');
  }
}
/** the preview's change against 按住對比 inside each face's box */
async function changed(page: Page, ids: string[]): Promise<number[]> {
  const frame = page.locator('.cam-stage .frame');
  await page.waitForTimeout(500);
  const now = await grab(frame);
  const release = await hold(page, page.locator('.cam-controls .side-btn', { hasText: '按住對比' }));
  await page.waitForTimeout(400);
  const held = await grab(frame);
  await release();
  return Promise.all(ids.map(async (id) => regionDiff(held, now, (await camBox(page, id)).rect).inside));
}

test('E1 fresh camera = original: composite only, the preview equals 按住對比, the capture the frame handed to 編輯', async ({ page }) => {
  await armShotOriginal(page);
  await openCamera(page);
  await page.waitForTimeout(1000);
  expect((await debugState(page)).passes).toEqual(['composite']);
  const frame = page.locator('.cam-stage .frame');
  const shown = await grab(frame);
  const release = await hold(page, page.locator('.cam-controls .side-btn', { hasText: '按住對比' }));
  await page.waitForTimeout(400);
  const held = await grab(frame);
  await release();
  expect(mad(shown, held)).toBeLessThanOrEqual(0.5);
  await page.evaluate(() => ((window as unknown as { __armOriginal: boolean }).__armOriginal = true));
  await page.getByRole('button', { name: '拍照' }).click();
  const d = await capturedVsOriginal(page);
  console.log(`E1 capture vs the unprocessed frame: ${JSON.stringify(d)}`);
  expect(d.same).toBe(true);
  expect(d.mad).toBeLessThanOrEqual(1);
});

test('E2 per person: B adjusted, then C; each keeps its result; the capture and 編輯 carry B and C, A stays 原圖', async ({ page }) => {
  test.setTimeout(300_000);
  const { A, B, C } = await openCamera(page);
  await tap(page, B);
  await natural(page);
  await page.getByRole('tab', { name: '美型', exact: true }).click();
  await page.getByRole('option', { name: '大眼', exact: true }).click();
  await dragSlider(page, 400);
  await tap(page, C);
  const [b1, c1, a1] = await changed(page, [B, C, A]);
  expect(b1).toBeGreaterThan(0.5);
  expect([c1, a1].every((v) => v < 0.3)).toBe(true);
  await natural(page);
  const [b2, c2, a2] = await changed(page, [B, C, A]);
  expect([b2 > 0.5, c2 > 0.5, a2 < 0.3]).toEqual([true, true, true]);
  const persons = new Map((await debugState(page)).boxes.map((x) => [x.id, x.edited]));
  expect([persons.get(A), persons.get(B), persons.get(C)]).toEqual([false, true, true]);
  await page.getByRole('button', { name: '拍照' }).click();
  await page.getByRole('button', { name: '編輯' }).click();
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 90_000 });
  await expect.poll(async () => (await debugState(page)).faces, { timeout: 60_000 }).toBe(3);
  const ed = (await debugState(page)).boxes;
  const eA = [...ed].sort((a, b) => a.y - b.y)[0];
  // saved mirrored (mirrorOnSave, front camera): B, left of C on the unmirrored frame, is right of C in the photo
  const [eC, eB] = ed.filter((b) => b !== eA).sort((a, b) => a.x - b.x);
  // the camera's target (C) names the primary through the seed, and the editor selects it
  expect((await debugState(page)).selected).toBe(eC.id);
  /** a person's value of one item: face ids f0… follow the display order, as the 人物 n chips do */
  const value = async (face: { id: string }, tab: string, item: string) => {
    await selectPerson(page, Number(face.id.slice(1)) + 1);
    await expect.poll(async () => (await debugState(page)).selected).toBe(face.id);
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await page.getByRole('option', { name: item, exact: true }).click();
    return Number(await page.getByRole('slider').getAttribute('aria-valuenow'));
  };
  expect(await value(eB, '美型', '大眼')).toBe(100);
  const c = await value(eC, '美型', '大眼'); // 自然's 大眼: C's camera value, not B's
  expect(c > 0 && c < 100).toBe(true);
  expect(await value(eA, '美膚', '磨皮')).toBe(0); // A: 原圖
  // a shot with nothing set opening at 原圖 (export MAD 0) is original.spec.ts's test (a), Task 11
});

test('E3 全部套用: on copies the target to all three; a slider writes all; a tap on A turns it off and selects A; nobody reverts', async ({ page }) => {
  const { A, B, C } = await openCamera(page);
  await tap(page, B);
  await preset(page, '自然');
  await page.addStyleTag({ content: '.all-chip { display: inline-flex !important; }' });
  const chip = page.getByRole('button', { name: '全部套用' });
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  expect((await changed(page, [A, B, C])).every((v) => v > 0.5)).toBe(true);
  await page.getByRole('tab', { name: '美膚', exact: true }).click();
  await page.getByRole('option', { name: '磨皮', exact: true }).click();
  await dragSlider(page, 400);
  expect((await debugState(page)).boxes.every((x) => x.edited)).toBe(true);
  const g = await camBox(page, A);
  await page.mouse.click(g.point.x, g.point.y);
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await debugState(page)).selected).toBe(A);
  expect((await changed(page, [A, B, C])).every((v) => v > 0.5)).toBe(true);
});
```

- [x] **Step 2: Run** — `npm run build && npx playwright test tests/e2e/camera-persons.spec.ts --project chromium-group`
Expected: 3 passed. E1's capture MAD is printed; if it exceeds 1, record the measured value in the test as its bound with a comment (a WebGL upload against a 2D copy, §12.2 E1), never above 2.

(Executed with these adaptations, 2026-10-20. The `original.spec.ts` anchors above predate Task 11: at this commit `Diff` and `exportDiff` were `:40-96`, the init script `keepShotOriginal` `:158-170` (now `armShotOriginal`), and the comparison the end of `shootArmed` `:186-199` (now `capturedVsOriginal`; `shootArmed` stays as arm, 拍照, `capturedVsOriginal`). `openCamera` also hides `.corner-label`, 按住對比's 「原圖」 tag, which is drawn over the frame only while held, so E1's whole-frame MAD would otherwise count it. E2: `value()` picks the tab and item before the person (S A11: the 人物 chips are not selectable while a photo item is active), the primary's selection is polled, and the test also checks 大眼 reads 100 after the drag and that no 「未帶入相機效果」 toast shows. E3 uses `natural()` instead of the bare preset: with 自然's 美白 and 銳化 on the whole frame, A and C differ from 按住對比 whether or not 全部套用 copied anything, so the copy check proved nothing. It also checks that only B differs before the chip, that `selected` is `'all'` while on and everyone is `edited`, and that 磨皮 reads 100 on A after the tap and on C (the slider wrote all three). E1 and E3 get `test.setTimeout(240_000)`: the three-face poll alone may take the config's 120 s. Measured on SwiftShader: E1 preview against 按住對比 MAD 0, capture against the unprocessed frame MAD 0 at the same size, so the bound stays 1. The behaviour already existed (Tasks 1–12), so each test was shown to fail against a deliberate break, built and run, then reverted (not committed): untouched faces drawn at 磨皮 0.55 → E1 fails at `passes`; v0.5's one look (every face drawn with the target's params) → E2 fails at "B keeps its result"; 全部套用 on copying nothing → E3 fails at "everyone edited"; the hand-over giving every matched face the first camera person's params → E2 fails at C's 大眼. Untouched faces drawn at weight 1 with neutral params changes nothing observable, since `planPasses` skips the mask pass at 磨皮 0, so no test can catch it. The full `npm run test:e2e` at this commit: 197 passed, 2 skipped (`@bench`), 1 failed, `detector.spec.ts:1299` D2 (CPU). It also fails alone, and Task 13 did not cause it (only test files changed, and that test uses none of them). The live camera never settles at 2 faces: it shows 5–6. A throwaway probe (not committed) logged the cause. On the group path (front, short-range, the whole view), face B, cut by the frame's top edge, gets a new track and a new person on every call (t1 → t157 in 45 s, the same box at y 0), and the old ones are held for `LOST_HOLD_MS`. `ovalBox` clamps the detection to y 0, so the tolerant `insideView` (`faceTracks.ts:84`, EDGE_EPS) lets it start a track (`:215`). The group path's `matchable` = `holdsWhole` (`liveViews.ts:70-74`, strict px, no epsilon) then keeps the track out of every match. Inferred, not traced: the track's predicted box (`predict`, `:247`, velocity × dt, unclamped) drifts above y 0 with landmark jitter, the only gate the logged boxes can fail; the other edges are 6 px or more inside the 370–910 crop. A face touching the crop's edge on the group path is therefore a new person on every detection (its edits are lost; A2's spirit). This is Task 8's code, left for its owner to fix. Review fix: E2 also checks the capture, spec §12.2 E2's "capture: Review shows B and C adjusted, A not" (U3), which the code above left out. It arms `armShotOriginal`, records B's, C's and A's preview rects (`camBox`) before 拍照, and compares 預覽's 拍攝結果 with the unprocessed frame inside each (`capturedRegions`, new in `fixtures.ts`; `capturedVsOriginal` is now its whole-frame case). Measured: B 6.37, C 5.05, A 0; the bounds are B, C > 0.5 and A < 0.3, as in the preview checks. Shown to fail against two deliberate breaks of `capture()` (built, run, reverted, not committed): every face drawn neutral → B and C 0; every face drawn at weight 1 with the target's params → A 5.19. E2 could not catch either before: 編輯 re-renders the unprocessed frame from the hand-over, which neither break touches (inferred, not run).)

- [x] **Step 3: Commit**

```bash
cd /d/GitSource/MonaLisa && git add tests/e2e/camera-persons.spec.ts tests/e2e/fixtures.ts tests/e2e/original.spec.ts && git commit -m "camera per-person: e2e E1–E3 (fresh camera = original, per person, 全部套用 copy)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" | cat
```

---

### Task 14: E2E E4, E4b, E5 and the one-face solo check

**Files:**
- Create: `tests/e2e/camera-groups.spec.ts`, `tests/e2e/camera-back.spec.ts`, `tests/e2e/camera-identity.spec.ts`
- Modify: `tests/e2e/camera.spec.ts` (one test added), `tests/e2e/fixtures.ts` (`open`, `flipBack`, `within`)

**Interfaces:**
- Consumes: `uprightCamera`, `cpuDelegate`, `camBox`; debug `livePath`, `liveDetector`, `liveEvery`, `boxes`, `selected`, `fps`; the knob `meiyan.debug.live.v1`.

- [ ] **Step 1: Write the tests**

`tests/e2e/fixtures.ts` (add, beside `camBox`, so the three new files share them):

```ts
/** the camera screen, opened and live (front camera) */
export async function open(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /拍攝/ }).click();
  await page.getByRole('button', { name: '點擊開啟相機' }).click();
  await expect.poll(async () => (await debugState(page)).cameraState, { timeout: 120_000 }).toBe('live');
}
/** flip to the back camera; resolves at its first live frame (Date.now()) */
export async function flipBack(page: Page): Promise<number> {
  await page.getByRole('button', { name: '切換鏡頭' }).click();
  await expect.poll(async () => (await debugState(page)).cameraState, { timeout: 30_000, intervals: [50] }).not.toBe('live');
  await expect.poll(async () => { const d = await debugState(page); return d.cameraState === 'live' && d.fps > 0; }, { timeout: 60_000, intervals: [50] }).toBe(true);
  return Date.now();
}
/** what is left of `ms` since `t0` (at least 1 ms): a poll timeout counted from an earlier moment */
export const within = (t0: number, ms: number): number => Math.max(1, ms - (Date.now() - t0));
```

`camera-groups.spec.ts`:

```ts
// E4 (camera per-person spec §12.2, gate PGR, K17, K20): ordinary group shots held upright, 1080 × 1920 clips.
import { camBox, cpuDelegate, debugState, expect, flipBack, open, test, uprightCamera, within } from './fixtures';

test.beforeEach(async ({ page }) => {
  await uprightCamera(page);
  await cpuDelegate(page, process.env.PGR_DELEGATE ?? 'CPU');
});

for (const [tag, n] of [['@row3', 3], ['@far10', 10]] as const) {
  test(`E4 back camera, upright: the group path finds all ${n} faces within 2 s of the first live frame, each tappable ${tag}`, async ({ page }) => {
    await open(page);
    const t0 = await flipBack(page);
    await expect.poll(async () => (await debugState(page)).faces, { timeout: within(t0, 2000), intervals: [100] }).toBe(n);
    expect(await debugState(page)).toMatchObject({ livePath: 'group', liveDetector: 'full-range' });
    for (const b of (await debugState(page)).boxes) {
      const g = await camBox(page, b.id, false);
      await page.mouse.click(g.point.x, g.point.y);
      await expect.poll(async () => (await debugState(page)).selected).toBe(b.id);
    }
    expect((await debugState(page)).fps).toBeGreaterThan(0);
  });
}

test('E4 option C on the same layout: one full-range VIDEO pass, the faces it finds recorded for §16 @far10', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('meiyan.debug.live.v1', JSON.stringify({ group: false })));
  await open(page);
  await flipBack(page);
  await page.waitForTimeout(5000);
  const d = await debugState(page);
  console.log(`option C faces on upright_far10: ${d.faces}`);
  expect(d).toMatchObject({ livePath: 'solo', liveDetector: 'full-range' });
});

test('E4 front camera, a group selfie: the group path starts with the second near face; the back row found within 2 s of the move @selfie', async ({ page }) => {
  await open(page);
  const seen: string[] = [];
  await expect.poll(async () => {
    const p = (await debugState(page)).livePath;
    if (p && seen.at(-1) !== p) seen.push(p);
    return p;
  }, { timeout: 60_000, intervals: [50] }).toBe('group');
  const t1 = Date.now();
  console.log(`selfie paths seen: ${seen.join(' → ')}`); // 'solo → group' (the move can land before the first sample)
  await expect.poll(async () => (await debugState(page)).faces, { timeout: within(t1, 2000), intervals: [100] }).toBe(5);
});
```

(`camBox(page, id, mirrored = true)`: the back camera's preview is not mirrored.)

`camera.spec.ts` (add, `face.y4m`):

```ts
test('A1: a lone selfie stays on the solo path: one short-range VIDEO pass on every frame', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /拍攝/ }).click();
  await page.getByRole('button', { name: '點擊開啟相機' }).click();
  await expect.poll(async () => (await debugState(page)).face, { timeout: 90_000, intervals: [500] }).toBe(true);
  for (let i = 0; i < 20; i++) {
    expect(await debugState(page)).toMatchObject({ livePath: 'solo', liveEvery: 1, liveDetector: 'short-range' });
    await page.waitForTimeout(250);
  }
});
```

`camera-back.spec.ts` (`group10.y4m`, landscape 1280 × 720; deviation recorded in Task 16: §12.2 E4b asks for ten faces on the group path, but the 3:4 crop of a 1280-wide frame shows only the faces inside x 370–910, and the group path tracks faces in view only):

```ts
// E4b (camera per-person spec §12.2): the landscape ten-face regression (K20), group path and option C.
import { camBox, cpuDelegate, debugState, expect, flipBack, open, test } from './fixtures';

/**
 * the faces composeFitWidth puts inside the 3:4 crop (x 370–910 of 1280). The scripts are untyped .mjs, imported
 * dynamically with a cast as detector.spec.ts:416 does (a static import is TS7016 under `strict`)
 */
async function facesInView(): Promise<number> {
  const { composeFitWidthBoxes } = (await import(new URL('../../scripts/gen-y4m.mjs', import.meta.url).href)) as {
    composeFitWidthBoxes(layout: unknown): { x: number; y: number; w: number; h: number }[];
  };
  const { TEN_FACES } = (await import(new URL('../../scripts/gen-group-fixture.mjs', import.meta.url).href)) as { TEN_FACES: unknown };
  return composeFitWidthBoxes(TEN_FACES).filter((b) => b.x >= 370 / 1280 && b.x + b.w <= 910 / 1280).length;
}

test('E4b back camera, the landscape ten-face clip: every face inside the visible crop found and tappable', async ({ page }) => {
  const inView = await facesInView();
  await cpuDelegate(page);
  await open(page);
  await flipBack(page);
  await expect.poll(async () => (await debugState(page)).faces, { timeout: 30_000 }).toBe(inView);
  for (const b of (await debugState(page)).boxes) {
    const g = await camBox(page, b.id, false);
    await page.mouse.click(g.point.x, g.point.y);
    await expect.poll(async () => (await debugState(page)).selected).toBe(b.id);
  }
});
test('E4b option C (LIVE_GROUP off): ten faces, full-range VIDEO, the cadence skips', async ({ page }) => {
  await cpuDelegate(page);
  await page.addInitScript(() => localStorage.setItem('meiyan.debug.live.v1', JSON.stringify({ group: false })));
  await open(page);
  await flipBack(page);
  await expect.poll(async () => (await debugState(page)).faces, { timeout: 60_000 }).toBe(10);
  expect((await debugState(page)).liveDetector).toBe('full-range');
  await expect.poll(async () => (await debugState(page)).liveEvery ?? 1, { timeout: 30_000 }).toBeGreaterThan(1);
});
```

(Task 12's `gen-y4m.mjs` exports `composeFitWidthBoxes(layout)`: each face's box in frame UV after `composeFitWidth`'s scale and bottom alignment. The `@bench` variant of §12.4 goes in `camera-groups.spec.ts`, tagged `@far10 @bench`, skipped without `BENCH`: back camera, 全部套用 on, 一鍵 › 自然, 10 s, `console.log` of `fps` and `liveEvery`.)

`camera-identity.spec.ts` (`group_move.y4m`, front camera; the clip loops every 18 s, so every step polls on the face count and the debug ids with a timeout of 25 s, never on time):

```ts
// E5 (camera per-person spec §12.2): identity through absences and a swap, on group_move.y4m (Task 12's timeline).
import type { Page } from '@playwright/test';
import type { DebugState } from '../../src/types';
import { camBox, debugState, expect, open, test } from './fixtures';

type Box = DebugState['boxes'][number];
const boxes = async (page: Page) => (await debugState(page)).boxes;
const of = (bs: Box[], person: string) => bs.find((b) => b.person === person);
const cx = (b: Box) => b.x + b.w / 2;
const P = { timeout: 25_000, intervals: [100] };

/** the clip's long absence (C gone ≥ 4.5 s), then C back: the 16.5 s mark, so the next steps meet the timeline in order */
async function syncOnLongAbsence(page: Page): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await expect.poll(async () => (await boxes(page)).length, P).toBe(2);
    await page.waitForTimeout(4500);
    if ((await boxes(page)).length === 2) break;
  }
  await expect.poll(async () => (await boxes(page)).length, P).toBe(3);
}

test('E5 identity: C away 1.5 s → the same person; B and C swap → each id follows its face; C away 5.5 s → a new person at 原圖, B unchanged', async ({ page }) => {
  test.setTimeout(240_000);
  await open(page);
  await expect.poll(async () => (await boxes(page)).length, { timeout: 120_000 }).toBe(3);
  await syncOnLongAbsence(page); // C is now present for 3.5 s (16.5–18 s, then 0–2 s of the next loop)
  const at = (bs: Box[]) => {
    const A = [...bs].sort((a, b) => a.y - b.y)[0];
    const [C, B] = bs.filter((b) => b !== A).sort((a, b) => cx(b) - cx(a));
    return { A, B, C };
  };
  const first = at(await boxes(page));
  const home = cx(first.C);
  // select C, then 一鍵 › 自然; one action per poll (a tap on the pinned face would collapse the panel)
  await expect.poll(async () => {
    const d = await debugState(page);
    const C = at(d.boxes).C;
    if (d.selected !== C.id) {
      const g = await camBox(page, C.id);
      await page.mouse.click(g.point.x, g.point.y);
      return false;
    }
    if (!C.edited) {
      await page.getByRole('tab', { name: '一鍵', exact: true }).click();
      await page.getByRole('option', { name: '自然', exact: true }).click();
      return false;
    }
    return true;
  }, P).toBe(true);
  const { B, C } = at(await boxes(page));
  const [cp, bp] = [C.person!, B.person!];
  // away 1.5 s, back near: the same person, still edited
  await expect.poll(async () => (await boxes(page)).length, P).toBe(2);
  await expect.poll(async () => (await boxes(page)).length, P).toBe(3);
  expect(of(await boxes(page), cp)).toMatchObject({ edited: true });
  // the swap: C's person on B's side, then home again
  await expect.poll(async () => { const bs = await boxes(page); return cx(of(bs, cp)!) < cx(of(bs, bp)!); }, P).toBe(true);
  await expect.poll(async () => { const bs = await boxes(page); return cx(of(bs, cp)!) > cx(of(bs, bp)!); }, P).toBe(true);
  // away 5.5 s (over the 4 s grace): whoever returns at C's place is a new person at 原圖
  await expect.poll(async () => (await boxes(page)).length, P).toBe(2);
  await page.waitForTimeout(4500);
  expect((await boxes(page)).length).toBe(2);
  await expect.poll(async () => (await boxes(page)).length, P).toBe(3);
  const back = (await boxes(page)).find((b) => Math.abs(cx(b) - home) < 0.05)!;
  expect([back.person === cp, back.edited]).toEqual([false, false]);
  expect(of(await boxes(page), bp)).toMatchObject({ edited: false });
});
```

- [ ] **Step 2: Run** — `npm run build && npx playwright test --project chromium-upright-row3 --project chromium-upright-far10 --project chromium-selfie-group --project chromium-group10 --project chromium-group-move && npx playwright test tests/e2e/camera.spec.ts --project chromium`
Expected: all pass; the option-C test prints `option C faces: N`. A failure of an E4 group-path test is a PGR failure: do not loosen it here, carry it to Task 16.

- [ ] **Step 3: Commit**

```bash
cd /d/GitSource/MonaLisa && git add tests/e2e/camera-groups.spec.ts tests/e2e/camera-back.spec.ts tests/e2e/camera-identity.spec.ts tests/e2e/camera.spec.ts && git commit -m "camera per-person: e2e E4 (upright group shots), E4b, E5 (identity) and the one-face solo check" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" | cat
```

---

### Task 15: Bench rows L (extended), LF, GS, WB, JG and their verdicts

**Files:**
- Modify: `src/bench/report.ts:242-316` (verdicts), `src/bench/report.test.ts`
- Modify: `src/bench/multiFace.ts:531-560` (`cameraVideo` upright), `:574-653` (`rowL`), add `rowLF`, `rowGS`, `rowWB`, `rowJG`, runners (`:764-765`), the section note (`:233`)
- Modify: `scripts/bench-multiface.mjs` (`--upright`)

**Interfaces:**
- Consumes: `startLiveLoop` (Tasks 3, 8), `LivePersons`, `createEngine`, `createCamera`, `layoutViews`, `mapLandmarks`, `tracker.warm`.
- Produces (report.ts):
  ```ts
  export const PGN_MIN_FPS = 24, PGN_MIN_FACE_HZ = 5, PLB_MAX_MS = 33, PGS_MAX_MS = 250, PWB_MAX_MS = 300;
  export interface LfRun { config: string; fps: number; longestMs: number; maxGapMs: number; every: number; faceHz: readonly number[]; views: readonly string[]; detectP50: number; renderP50: number; faces: number }
  export function lfRows(run: LfRun, optionCLongestMs: number | null): MultiRow[];          // the LF row, then PGN (≥ 2 faces) or PLB (1 face, back camera)
  export function pgnVerdict(r: Pick<LfRun, 'fps' | 'faceHz' | 'longestMs'>, optionCLongestMs: number | null): 'pass' | 'fail';
  export function pj1gVerdict(rms: number, rms1: number, lag: number, lag1: number): 'pass' | 'fail'; // RMS ≤ max(0.4, 1.25 × rms1) and lag ≤ 1.25 × lag1
  ```

- [ ] **Step 1: Write the failing tests** (`report.test.ts`)

```ts
describe('camera per-person verdicts (camera per-person spec §10)', () => {
  it('PGN: ≥ 24 fps average, every face ≥ 5 Hz, the longest frame no longer than option C’s', () => {
    expect(pgnVerdict({ fps: 25, faceHz: [5.2, 7], longestMs: 60 }, 69)).toBe('pass');
    expect(pgnVerdict({ fps: 23.9, faceHz: [7], longestMs: 60 }, 69)).toBe('fail');
    expect(pgnVerdict({ fps: 25, faceHz: [4.9, 7], longestMs: 60 }, 69)).toBe('fail');
    expect(pgnVerdict({ fps: 25, faceHz: [7], longestMs: 70 }, 69)).toBe('fail');
    expect(pgnVerdict({ fps: 25, faceHz: [7], longestMs: 500 }, null)).toBe('pass');
  });
  it('PJ1G: RMS ≤ max(0.4 px, 1.25 × numFaces 1) and lag ≤ 1.25 × numFaces 1', () => {
    expect(pj1gVerdict(0.39, 0.1, 10, 10)).toBe('pass');
    expect(pj1gVerdict(0.5, 0.39, 10, 10)).toBe('fail');
    expect(pj1gVerdict(0.3, 0.3, 12.6, 10)).toBe('fail');
  });
  it('lfRows: PLB for one face on the back camera (detect p50 + render p50 ≤ 33 ms), PGN for ≥ 2 faces', () => {
    const one = lfRows({ config: 'GPU back group', fps: 30, longestMs: 40, maxGapMs: 40, every: 1, faceHz: [30], views: ['whole'], detectP50: 19, renderP50: 5, faces: 1 }, null);
    expect(one.find((r) => r.row === 'PLB')?.values).toMatchObject({ ms: 24, limit_ms: PLB_MAX_MS, verdict: 'pass' });
    const ten = lfRows({ config: 'GPU back group', fps: 25, longestMs: 60, maxGapMs: 70, every: 1, faceHz: Array(10).fill(7), views: ['whole', 't0,0'], detectP50: 32, renderP50: 5, faces: 10 }, 69);
    expect(ten.find((r) => r.row === 'PGN')?.values.verdict).toBe('pass');
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run src/bench/report.test.ts` → FAIL.

- [ ] **Step 3: Implement the verdicts and the rows**

- `report.ts`: the constants, `pgnVerdict`, `pj1gVerdict`, `lfRows` (LF values: `fps`, `longest_ms`, `max_gap_ms`, `every`, `min_face_hz`, `views`, `detect_p50_ms`, `render_p50_ms`, `faces`; PGS / PWB rows are built by their rows with `PGS_MAX_MS`, `PWB_MAX_MS`).
- `multiFace.ts`:
  - `cameraVideo()` requests 1080 × 1920 when the page URL has `upright=1`.
  - `rowL`: counts `[1, 3, 10]` × detectors `['camera', 'photo']` (VIDEO, `detectVideo(…, { maxFaces: n, detector })`) × GPU / CPU; then the group-path call p50 per view kind (`whole`, the first tile of `layoutViews(…, 'environment', 'photo')` and of `(…, 'user', 'camera')`) with `detectView` on the copies (the call the app makes); `liveRows` gives PL2 from the `camera` detector rows only (the front solo path).
  - `rowLF(group: boolean)`: an engine on a hidden canvas (`createEngine`), `createCamera()` started `'environment'`, a `LivePersons` with `setAll(true)` and `edit` of a person with 磨皮 0.6, 大眼 0.5, 瘦臉 0.5 and 口紅 on, `startLiveLoop({ …, group })` for 2 s warm-up and 10 s measured; it samples `__meiyan` every frame: frame intervals (fps, longest, max gap from rVFC `presentedFrames`), `liveEvery`, `liveViews`, and per box id the distinct `seen` values (refresh Hz). Runners `LF` (group) and `LFC` (`group: false`).
  - `rowGS`: the same on the front camera with `selfie_group.y4m`; for each `livePath` change, the longest frame within ±1 s; PGS row per change.
  - `rowWB`: a fresh tracker; `warm('IMAGE', 'photo')` timed (`warm_ms`, the cold compile), then the first group-path frame after `camera` goes live timed (`first_ms`); PWB row. It must be the page's first full-range work (run it alone on a fresh page).
  - `rowJG`: jitter (static clip, 2 s) and lag (pan clip, 4 s) of the group path's IMAGE landmarks through the app smoother, refreshed by the whole view and by a tile holding the face, beside MediaPipe's own numFaces-1 VIDEO smoothing on the same frames (as `jitterLag`, `:671-717`); PJ1G rows per refresh kind.
- `bench-multiface.mjs`: `--upright` appends `upright=1` to the page URL; `--option-c <ms>` appends `optionC=<ms>`, which `rowLF` passes to `lfRows` as PGN's longest-frame bound (absent → that condition is not judged). Both flags, and `--option-c`'s value, are taken out of the row ids the way `--video` and its value are (`bench-multiface.mjs:14`), so `--upright … LF` runs row `LF` only.

- [ ] **Step 4: Run** — `npx vitest run src/bench && npm run typecheck && npm run build && npx playwright test tests/e2e/bench.spec.ts --project chromium` → PASS (the bench page still mounts its sections).

- [ ] **Step 5: Commit**

```bash
cd /d/GitSource/MonaLisa && git add src/bench/report.ts src/bench/report.test.ts src/bench/multiFace.ts scripts/bench-multiface.mjs && git commit -m "camera per-person: bench rows L (counts 1/3/10, both detectors, view calls), LF, GS, WB, JG and the PGN / PLB / PGS / PWB / PJ1G verdicts" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" | cat
```

---

### Task 16: The desktop gates decide K17; numbers and pointers go into the docs

**Files:**
- Modify (only if a gate fails after its allowed fixes): `src/config/limits.ts` (`LIVE_GROUP = false`, or a `DETECTOR_FLOOR` / `LIVE_SCAN_EVERY` / `ONE_EURO_GROUP` change, each with the numbers in its doc comment)
- Create: `src/app/faceTracks.bench.test.ts` (PB)
- Modify: `docs/superpowers/specs/2026-10-19-camera-per-person-design.md` (§6.1 a dated "Plan measurements" subsection, §10 outcomes, §12.2/§12.3 the two recorded deviations, §16 only if a gate failed), `docs/superpowers/specs/2026-10-12-v04-roadmap.md` (§2.4 and §3.7: a pointer to this spec), `docs/superpowers/specs/2026-10-12-face-person-select-design.md` (§0.1 camera row, §1.2 item 4, §2.5: "superseded by 2026-10-19-camera-per-person-design.md")

**Interfaces:**
- Consumes: every row of Task 15, Task 14's E4 tests.

- [ ] **Step 1: PB, the bookkeeping benchmark**

`src/app/faceTracks.bench.test.ts`: `it.runIf(process.env.BENCH)('PB: matching + re-identification + smoother at 10 faces ≤ 1 ms per detection', …)` — a `FaceTracks` on an edited session, 10 `lmAt` faces jittered ±0.002, 50 warm-up and 1000 timed `detect` + `step` calls; `expect(mean).toBeLessThanOrEqual(1)`, the mean printed.
Run: `cd /d/GitSource/MonaLisa && BENCH=1 npx vitest run src/app/faceTracks.bench.test.ts`
Expected: PASS, `PB mean ≤ 1 ms` printed. Over → profile (no limit changes, §10 PB).

- [ ] **Step 2: PGR (recall), CPU three runs, GPU three runs**

Run: `npm run build && npx playwright test --project chromium-upright-row3 --project chromium-upright-far10 --project chromium-selfie-group --repeat-each 3 --grep-invert @bench`
then `PGR_DELEGATE=auto npx playwright test --project chromium-upright-row3 --project chromium-upright-far10 --project chromium-selfie-group --repeat-each 3 --grep-invert @bench --headed`
Expected: every group-path E4 test passes 3 of 3 on each delegate.

- [ ] **Step 3: PGN, PLB, PJ1G, PGS, PWB on the desktop GPU (headed Chrome) and CPU**

Run, in this order, each on a fresh page (`tests/fixtures/group_pan.y4m` is gitignored and made by no setup: if missing, `node scripts/gen-y4m.mjs --src tests/fixtures/group_faces.png --out tests/fixtures/group_pan.y4m --pan 0.5`, as step 1 made it):
`node scripts/bench-multiface.mjs --video tests/fixtures/group10.y4m LFC` (option C at 10 faces: its `longest_ms` is PGN's bound),
`node scripts/bench-multiface.mjs --upright --option-c <LFC's longest_ms> --video tests/fixtures/upright_far10.y4m LF` (PGN),
`node scripts/bench-multiface.mjs --video tests/fixtures/face.y4m LF` (PLB: one face, back camera),
`node scripts/bench-multiface.mjs --video tests/fixtures/face.y4m JG` and `--video tests/fixtures/group_pan.y4m JG` (PJ1G),
`node scripts/bench-multiface.mjs --upright --video tests/fixtures/selfie_group.y4m GS` (PGS),
`node scripts/bench-multiface.mjs --video tests/fixtures/face.y4m WB` (PWB).
Expected: verdict rows printed per delegate; PGN, PJ1G pass; PLB ≤ 33 ms; PGS ≤ 250 ms and PWB ≤ 300 ms are reported (no limits line for them, §10).

- [ ] **Step 4: Apply the allowed fixes, or the fallback**

A failing desktop gate first gets the fix §10 names, measured again (one change at a time, its numbers in the `limits.ts` comment): PGR → `DETECTOR_FLOOR` margin (`camera: 0.10`, `photo: 0.07`), then the schedule (`LIVE_SCAN_EVERY = 3`); PGN → `LIVE_SCAN_EVERY`, the cadence constants; PJ1G → a group-path smoother constant `ONE_EURO_GROUP` (`minCutoff 0.025`, then `beta 160`; `FaceTracks` uses it for tracks refreshed on the group path). Still failing → `export const LIVE_GROUP = false;` with the failing gate and its numbers in the comment, then `npm run build` and re-run Task 14's option-C tests and E4b's option-C test (they must pass), and write spec §16 item 1's outcome (the gate, by how much, the fallback floors back ≥ ~9 % / front ≥ ~12 % for the release notes). PLB failing → `LIVE_DETECTOR.environment = 'camera'`.

- [ ] **Step 5: PL2 on the solo path**

Run: `node scripts/bench-multiface.mjs --video tests/fixtures/face.y4m L`
Expected: a `PL2` row per delegate for the `camera` detector with `verdict pass` (desktop 2026-10-19: Δp50 3.3 ms GPU, 1.6 ms CPU, limit 5).

- [ ] **Step 6: Record**

Spec §6.1: "Plan measurements (date, machine)" with every printed row (L, LF, LFC, GS, WB, JG, PB) and the E4 run counts; §10: the outcome per desktop gate, and that PLB is read from row LF (it needs the live render, which row L does not run); §12.2/§12.3/§12.4 and §6.3: the four deviations (E4b counts the faces inside the visible crop; `group_move` is 18 s and returns to its first frame; the `@bench` 10-face variant runs on `upright_far10`, since on the group path `group10`'s 3:4 crop shows fewer than ten faces; the group path calls `detectView`, `detectImage` with the live path's guards, because `detectImage` answers `[]` for an unusable tracker and A5 needs a null there); §16 only if a gate failed. The iPhone rows (PLN, PM1c, and PL2 / PJ1 / PJ2 on the phone) need the preview deploy after the push and are not measured here (§10, §16's closing paragraph). RM §2.4 and §3.7, S §0.1 (camera row), §1.2 item 4 and §2.5: one line each pointing to this spec. (The RM §15 0.6.0 release notes and `package.json` are Task 17, written from these outcomes.)

- [ ] **Step 7: Commit**

```bash
cd /d/GitSource/MonaLisa && git add src/app/faceTracks.bench.test.ts src/config/limits.ts docs/superpowers/specs && git commit -m "camera per-person: desktop gates (PGR, PGN, PJ1G, PL2, PB) measured and recorded; spec pointers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" | cat
```

---

### Task 17: 0.6.0 and its release notes (K16, §13)

**Files:**
- Modify: `package.json` (`"version"`), `package-lock.json` (its two `version` fields, through `npm version`)
- Modify: `src/ui/updateModel.test.ts:108-110, :156-158` (a 0.6.0 case beside each 0.5.0 one)
- Modify: `docs/superpowers/specs/2026-10-12-v04-roadmap.md` (new `## 15. Release notes: v0.6 (0.6.0, YYYY-MM-DD)` with the commit's date after §14, `:1094-1110`)
- Commit with them: `docs/superpowers/plans/2026-10-19-camera-per-person.md` (this plan; plans are tracked, `docs/superpowers/plans/`), so Task 18's tree is clean

**Interfaces:**
- Consumes: Task 16's recorded outcomes (which path shipped, the measured floors, PGS / PWB, the option-C face count of E4).

- [ ] **Step 1: Add the version cases** (`src/ui/updateModel.test.ts`; they pass without code changes, as RM §1.3 item 1 says: `displayVersion` is generic)

```ts
it('names 0.6.0 as v0.6 (camera per-person spec §13, K16)', () => {
  expect(bannerTitle(available({ next: '0.6.0' }))).toBe('有新版本 v0.6');
});
it('after the 0.6.0 update', () => {
  expect(updatedNotice('0.5.0', '0.6.0', true)).toBe('已更新至 v0.6');
});
```

- [ ] **Step 2: Bump the version**

Run: `cd /d/GitSource/MonaLisa && npm version 0.6.0 --no-git-tag-version`
Expected: `v0.6.0`; `git diff --stat | cat` lists `package.json` and `package-lock.json` only.

- [ ] **Step 3: Write RM §15** (繁體中文, then English, then Compatibility, as §14 is laid out), from the spec and Task 16's outcomes, each item one bullet:
- per-person beauty in the camera: tap a face, the sliders adjust that person only, everyone keeps their result in the preview and the photo; 全部套用 copies the selected person's settings to everyone in view (K10); untouched people and a fresh camera are 原圖 (U2–U4);
- settings follow people through moves, swaps and short absences; back within 4 s near where they left is the same person, else a new person at 原圖; no face recognition, and someone stepping in where a person left within 4 s takes that person's settings (U5, K7, §14 R3);
- 編輯 continues each person's camera result; a person the editor does not find is left out with 「{n} 位人物在照片中未偵測到臉部，未帶入相機效果」; a camera with nothing set and every import still open at 原圖 (U6, K14, K21);
- group shots held upright: the faces found, with the floors that shipped (group path: back camera down to about 3 % of the long edge, front-camera group scenes about 5 %; or, if `LIVE_GROUP = false` shipped, the fallback's ~9 % / ~12 %, stated plainly with the gate that failed), up to 10 people; with many people the face updates slow down to keep the preview smooth (K3, K6, K17);
- the front camera's solo selfie is unchanged; far people behind a solo selfie are found once someone nearer joins, or on the back camera; the move between the two shows one short hitch (K18, PGS's number);
- Compatibility: 0.5's saved camera face look (磨皮, 美型, 美妝 in the camera) is no longer applied; the photo look (濾鏡, 調節, 質感, 美白, 銳化) is kept (K15, §14 R8); per-person settings last only while the camera is open (K4); a rollback to 0.5 starts the camera's faces at 原圖 (§9); a 0.5.0 install shows 「有新版本 v0.6」, then 「已更新至 v0.6」, and after deploying `/version.json` returns `0.6.0`.

- [ ] **Step 4: Run**

Run: `cd /d/GitSource/MonaLisa && npx vitest run src/version.test.ts src/ui/updateModel.test.ts && npm run typecheck`
Expected: PASS (`APP_VERSION` is `0.6.0`, read from `package.json` by `vitest.config.ts`); typecheck 0.

- [ ] **Step 5: Commit**

```bash
cd /d/GitSource/MonaLisa && git add package.json package-lock.json src/ui/updateModel.test.ts docs/superpowers/specs/2026-10-12-v04-roadmap.md docs/superpowers/plans/2026-10-19-camera-per-person.md && git commit -m "camera per-person: version 0.6.0, release notes in the roadmap §15" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" | cat
```

---

### Task 18: Gate

**Files:** none (verification only; a failure goes back to the task that owns the code).

- [ ] **Step 1: Typecheck**

Run: `cd /d/GitSource/MonaLisa && npm run typecheck`
Expected: exits 0, no output.

- [ ] **Step 2: Unit tests**

Run: `npm test`
Expected: every test file passes (0 failed); the count is above 0.5.0's 2204.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `tsc` clean, `vite build` writes `dist/` (with `dist/sw.js`), no error.

- [ ] **Step 4: The full e2e suite**

Run: `npm run test:e2e`
Expected: every project passes (`chromium`, `chromium-group`, `chromium-upright-row3`, `chromium-upright-far10`, `chromium-selfie-group`, `chromium-group10`, `chromium-group-move`); `@bench` tests skipped.

- [ ] **Step 5: The PL2 single-face camera budget**

Run: `node scripts/bench-multiface.mjs --video tests/fixtures/face.y4m L`
Expected: `| PL2 | GPU | … verdict pass |` and `| PL2 | CPU | … verdict pass |` for the `camera` detector (Δp50 ≤ 5 ms).

- [ ] **Step 6: Line endings and the tree**

Run: `git status --short | cat` (expected: clean) and the Global Constraints' line-ending check on every CRLF file listed there (expected: `ok` for each).
