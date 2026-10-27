// Editor face-detection / export / 美體 bookkeeping (spec §7.2.4, body research report §落地設計), kept pure so
// it can be unit-tested without a DOM.
import type { SessionFace } from '../app/still';
import type { BodyFieldInput, BodyPersonInput } from '../body/field';
import { MAX_EDIT_FACES } from '../config/limits';
import { bodyBox, scanned0, shortScan } from '../detect/cache';
import type { HitCtx } from '../detect/persons';
import type { FrameFaceIn } from '../edit/frame';
import { personOf } from '../edit/state';
import { upQuarter, type Affine, type Quarter } from '../geometry/view';
import { hasValue, paramsInGroup } from '../engine/params';
import { stableKey } from '../store/undo';
import { protectWindow } from '../tracking/faceProtect';
import type { BodyMeasure } from '../body/measure';
import type {
  BeautyParams,
  BodyDetection,
  BodyDetections,
  BodyField,
  BodyTracker,
  DetectionCache,
  EditState,
  Face,
  Geometry,
  ParamId,
  PersonId,
  PersonInfoCached,
  Rect,
  RegionStatus,
  Selection,
  TrackerState,
} from '../types';
import { contourActiveValues, type ProtectRequest } from './faceProtectModel';
import { BODY_NONE_NOTE, BODY_WAIT_REASON, type BodyContext, type TabId } from './panelModel';
import type { BodyTrackerState } from './services';

/**
 * Create the still session (its constructor runs the one synchronous face detection) and decide whether its
 * "no face" is a real answer. unsure: the tracker could not answer, because it was unhealthy before the call,
 * or the call itself found it unusable (tracker.ts retires a lost instance and reports 'lost' synchronously
 * before returning null), or the detect call threw (faceKnown false).
 */
export function detectSession<S extends { faces: readonly unknown[]; faceKnown: boolean }>(
  hasTracker: boolean,
  healthy: () => boolean,
  create: () => S,
): { s: S; unsure: boolean } {
  const before = healthy();
  const s = create();
  const unsure = hasTracker && s.faces.length === 0 && (!before || !healthy() || !s.faceKnown);
  return { s, unsure };
}

/**
 * Where the session's faces come from (S §3.3 item 3). A fitting cache with an upright answer (the photo's own, or one
 * found before an engine recovery took the session) is used as is, also without a tracker (基本模式); anything else
 * asks the tracker. `asks` is detectSession's hasTracker: only a session that asks the tracker can be unsure, so cached
 * faces, none included, stay a definite answer whatever the tracker's health. A cache the short-range detector answered
 * (DetectionCache.photoDetector, step-1 spec §6.5) is used as is too, faceless or not: its completion is a detection of
 * its own, after the session is bound (completionOf).
 */
export function sessionPlan(cache: DetectionCache | null, hasTracker: boolean): { useCache: boolean; asks: boolean } {
  const useCache = cache !== null && (!hasTracker || scanned0(cache));
  return { useCache, asks: hasTracker && !useCache };
}

/**
 * A session without a tracker that holds back the photo's first answer (roadmap §15): a dropped cache's persons (the
 * open's rematch) meet a 基本模式 answer with no face, which drops them for good (migrate.ts knownOnly). While a
 * timed-out tracker build may still bring a tracker (services.ts trackerComing), the session is drawn without an answer,
 * and the bind that tracker brings answers instead, renaming them. A session bound with no tracker coming answers as
 * 基本模式 does. One that held its answer keeps holding it if the build fails after all: the persons wait for the next
 * open's tracker, and 美體 does not wait for the answer (bodyWaitsForFaces).
 */
export function holdsFirstAnswer(s: { hasTracker: boolean; useCache: boolean; answered: boolean; rematch: boolean; trackerComing: boolean }): boolean {
  return !s.hasTracker && !s.useCache && !s.answered && s.rematch && s.trackerComing;
}

/**
 * The 美體 detection waits for the photo's first face answer (S §7): the bodies join its persons. It does not wait for an
 * answer that may never come: a tracker that could not answer (unsure), or a bind that holds the answer for a tracker
 * still coming (holdsFirstAnswer: the build may fail, or never land). The bodies then build the photo's cache
 * (preAnswerCache), which carries a dropped cache's rematch to the face answer.
 */
export function bodyWaitsForFaces(s: { cached: boolean; unsure: boolean; held: boolean }): boolean {
  return !s.cached && !s.unsure && !s.held;
}

/**
 * The completion of a short-range answer (step-1 spec §6.5): a cache whose answer the short-range detector gave while the
 * full-range one was missing (DetectionCache.photoDetector) gains, once that detector is in, what one full-range
 * detection finds (completeAnswer). It runs where the answer it completes was found: a cache with faces in its last face
 * scan's up-frame (a cache with faces is never scanned again, so that is where its faces were found), a faceless one
 * where a short-range record is owed its full-range look (FaceScanRecord.detector): upright when that one is (or no
 * record says), else the last one owed; the scan asks any other owed up-frame the photo is shown in (needsFaceScan).
 * null: nothing to complete (no mark, or no upright answer yet: the session's own detection comes first).
 */
export function completionOf(cache: DetectionCache | null): { quarter: Quarter } | null {
  if (!cache || cache.photoDetector !== 'short-range' || !scanned0(cache)) return null;
  if (cache.faces.length) return { quarter: cache.faceScans[cache.faceScans.length - 1]?.quarter ?? 0 };
  const owed = cache.faceScans.filter(shortScan);
  return { quarter: !owed.length || owed.some((s) => s.quarter === 0) ? 0 : owed[owed.length - 1].quarter };
}

/**
 * The completion is owed in this open: there is one (completionOf), a tracker to run it, the full-range detector is in,
 * and it has not run in this open (it runs once per open, whatever it found; a further open tries again while the mark
 * stays). A face scan waits for it (it rewrites a faceless cache's scan records), and it waits for completionHeld.
 */
export function completionDue(s: { cache: DetectionCache | null; tried: boolean; hasTracker: boolean; detectorIn: boolean }): { quarter: Quarter } | null {
  if (s.tried || !s.hasTracker || !s.detectorIn) return null;
  return completionOf(s.cache);
}

/**
 * What holds a due completion back for now (it runs once nothing does, in the same open): no session bound to the
 * engine, or one whose answer is not definite (the re-detect comes first); a tracker that is not 'ok' (a probe could not
 * answer, and would spend the open's one try: the cached answer stays meanwhile, a definite one, so no tool is gated); a
 * face scan pending; or what the synchronous detection would freeze (裁切, a stroke or a slider drag, an export: a
 * tiled one or a working-size 儲存 in 準備中, whose file a rebase meanwhile would drop).
 */
export function completionHeld(s: { bound: boolean; unsure: boolean; health: TrackerState; scanPending: boolean; busy: boolean }): boolean {
  return !s.bound || s.unsure || s.health !== 'ok' || s.scanPending || s.busy;
}

/**
 * What a completion merged into a cache with faces (completeAnswer, step-1 spec §6.5) shows beside its new persons.
 * `redraws`: the saved thumbnail is owed, because the render changed: a new face, or a new obstacle, which bounds the
 * cap of a face's warp (§4.1) and which every frame reads from the cache, so a completion that adds nobody can redraw
 * too (a face full-range finds past the cap or below MIN_FACE_FRAC beside a cached one). `notices`: with new faces, what an
 * answer says (answerNotices, the first group photo's hint included: `hint` takes it); without, only what the cache now
 * says and did not before, never the hint (the eleventh face it found: 「偵測到超過 10 張臉」; round 5: round 4 showed
 * nothing and owed no thumbnail unless a face was added)
 */
export function completionShows(before: DetectionCache, after: DetectionCache, added: readonly string[], hint: () => boolean): { redraws: boolean; notices: string[] } {
  const n = after.persons.length;
  if (added.length) return { redraws: true, notices: answerNotices(after, n, n >= 2 && hint()) };
  const had = answerNotices(before, before.persons.length, false);
  return {
    redraws: stableKey(before.obstacles) !== stableKey(after.obstacles),
    notices: answerNotices(after, n, false).filter((t) => !had.includes(t)),
  };
}

/** the up-frame scan record lives with the cache (src/detect/cache.ts), so firstAnswer can write it too */
export { addFaceScan } from '../detect/cache';

type FaceScan = { quarter: number; flipH: boolean; detector?: 'short-range' };

/**
 * one face scan in the current up-frame (S §3.6, D12): normal mode, a tracker, no face known, the up-frame unscanned,
 * or answered by the short-range detector while full-range is in now (`fullRange`, step-1 spec §6.5: the completion
 * owes that record its full-range look). Only after the upright answer: a cache without it (a 基本模式 cache, or one 美體
 * wrote while the tracker could not answer, S §7) waits for the session's own detection, which asks upright first
 * (sessionPlan; RedetectBudget retries it). (The editor also holds a scan while a completion is due, completionDue: the
 * completion asks upright first, which may find the faces, and leaves the scan whatever up-frame is still owed.)
 */
export function needsFaceScan(s: {
  cache: { faces: readonly unknown[]; faceScans: readonly FaceScan[] } | null;
  geometry: Geometry;
  mode: 'crop' | 'normal';
  hasTracker: boolean;
  fullRange?: boolean;
}): boolean {
  if (s.mode !== 'normal' || !s.hasTracker || !s.cache || s.cache.faces.length > 0) return false;
  if (!s.cache.faceScans.some((x) => x.quarter === 0)) return false;
  const q = upQuarter(s.geometry);
  const rec = s.cache.faceScans.find((x) => x.quarter === q);
  return !rec || (!!s.fullRange && rec.detector === 'short-range');
}

/**
 * The face scan about to run re-asks an up-frame that already has an answer (a short-range "nobody" the completion owes
 * its full-range look, needsFaceScan): its 「未偵測到臉部」 was shown when that answer was fresh, so a "nobody" now says
 * nothing (step-1 spec §6.5, S §8.4; round 4: round 3 showed it again, on a reopen too)
 */
export function rescanOf(cache: { faceScans: readonly FaceScan[] } | null, quarter: Quarter): boolean {
  return !!cache?.faceScans.some((x) => x.quarter === quarter);
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

/** a cache's 美體 up-frames once a detection ran in `q`: added to the earlier ones, none before its first (bodies null) */
export function bodyScansAfter(cache: { bodies: readonly unknown[] | null; bodyScans?: readonly Quarter[] }, q: Quarter): Quarter[] {
  return addBodyScan(cache.bodies === null ? [] : cache.bodyScans, q);
}

/** non-answers in a row before the editor stops re-detecting; = tracker ESCALATE_AFTER, so repeated throws reach its instance replacement */
export const MAX_REDETECTS = 3;

/**
 * When to detect again on the same photo. Only non-answers spend the budget (a definite answer clears
 * `unsure`, which stops the retries by itself); a tracker recovery (lost / failed → ok) refills it. Bounded
 * because the tracker's own backoff and retry limits bound how often it recovers.
 */
export class RedetectBudget {
  private used = 0;
  constructor(private health: TrackerState) {}

  /** true → detect again now (call on every change of the binding or the tracker health) */
  next(unsure: boolean, health: TrackerState): boolean {
    if (health !== this.health) {
      if (health === 'ok') this.used = 0;
      this.health = health;
    }
    if (!unsure || health !== 'ok' || this.used >= MAX_REDETECTS) return false;
    this.used++;
    return true;
  }
}

/**
 * Run an export on `s`; when it fails because `s` was replaced meanwhile (a re-detect or an engine recovery
 * disposed it mid-export), run it again on the replacement, at most `retries` times. `replacement` returns
 * the session that took over from the failed one, or null when the failure stands.
 */
export async function exportOnLatest<S, T>(
  s: S,
  run: (s: S) => Promise<T>,
  replacement: (failed: S) => S | null,
  retries = 2,
): Promise<{ s: S; result: T }> {
  for (let left = retries; ; left--) {
    try {
      return { s, result: await run(s) };
    } catch (e) {
      const next = left > 0 ? replacement(s) : null;
      if (!next) throw e;
      s = next;
    }
  }
}

/** how often whenRestored asks whether its wait was superseded */
export const RESTORE_POLL_MS = 100;

/**
 * C §7: wait for a lost engine's context to come back. true once it is restored (at once for a live engine), false
 * after `timeoutMs`, when the rebuild failed, or as soon as `superseded()` says the wait is moot (polled every
 * RESTORE_POLL_MS): 重新載入引擎 (recoverEngine) disposes this engine, so its canvas never fires the restore, and a
 * session on the new engine takes over; the caller then fails at once and exportOnLatest runs on that session. The
 * listener is added after the engine's and the still session's own (both registered at creation), so on true the engine
 * is rebuilt and the session has re-armed its texture waits: prepareExport then waits for the reloaded textures. A loss
 * during the tiles hands its 標準 fallback here.
 */
export function whenRestored(
  engine: { readonly lost: boolean; readonly canvas: EventTarget },
  timeoutMs: number,
  superseded: () => boolean = () => false,
): Promise<boolean> {
  if (!engine.lost) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      clearInterval(poll);
      engine.canvas.removeEventListener('webglcontextrestored', done);
      resolve(!engine.lost);
    };
    const timer = setTimeout(done, timeoutMs);
    const poll = setInterval(() => {
      if (superseded()) done();
    }, RESTORE_POLL_MS);
    engine.canvas.addEventListener('webglcontextrestored', done);
  });
}

// ───────────────────────── 美體 ─────────────────────────

/**
 * What the editor knows about the bodies in this photo:
 * idle → not asked yet · working → pose model download / graph creation / detection · done → detected (the bodies are
 * in the DetectionCache; `det` is what the panel reads, null = nobody) · error → retryable failure.
 */
export type BodyDet =
  | { phase: 'idle' }
  | { phase: 'working' }
  | { phase: 'done'; det: BodyDetection | null }
  | { phase: 'error'; message: string };

// (the panel gates every detection-driven slider itself until the status is 'ready': same words here)
export const BODY_NONE_REASON = BODY_NONE_NOTE;
export const BODY_LOADING_REASON = BODY_WAIT_REASON;

const BODY_DEFS = paramsInGroup('body');

/** Some 美體 slider is off neutral: the photo needs a detection to show it (the 增高 band works without one). */
export function needsBodyMeasure(p: BeautyParams): boolean {
  return BODY_DEFS.some((d) => hasValue(d, p.values[d.id]));
}

/**
 * Start detecting now? First time the 美體 tab opens, or right away when the params already use body
 * sliders (a reopened entry without a cached detection). Waits for the history-cache read; never repeats a
 * finished one; an error is retried only when the user comes back to the tab (`entered`).
 */
export function shouldDetectBody(det: BodyDet, want: { tabOpen: boolean; entered: boolean; params: BeautyParams }): boolean {
  if (det.phase === 'error') return want.entered;
  if (det.phase !== 'idle') return false;
  return want.tabOpen || needsBodyMeasure(want.params);
}

/**
 * Detect every person on the photo with the session's body tracker. `pause` runs between getting the tracker
 * and the synchronous detection (let the 正在偵測人物 note paint); `cancelled` → undefined (the editor closed,
 * the photo is gone). A throw propagates (an error state with 重試): the tracker rebuilds its own graph on the
 * next call, so a retry reuses it rather than creating a second MediaPipe instance (each is its own wasm heap).
 */
export async function detectBody(
  ensure: () => Promise<BodyTracker>,
  image: ImageBitmap,
  opts: { pause?: () => Promise<void>; cancelled?: () => boolean; recoverWait?: () => Promise<void> } = {},
): Promise<BodyDetections | null | undefined> {
  const t = await ensure();
  await opts.pause?.();
  for (let attempt = 0; ; attempt++) {
    if (opts.cancelled?.()) return undefined;
    try {
      return t.detect(image);
    } catch (e) {
      // the tracker is rebuilding a lost GPU graph in the background (bodyTracker.ts BodyTrackerRecovering):
      // wait for it instead of surfacing an error the user would have to 重試 by hand
      if (!isRecovering(e) || attempt >= RECOVER_TRIES) throw e;
      await (opts.recoverWait ?? (() => new Promise<void>((r) => setTimeout(r, RECOVER_WAIT_MS))))();
    }
  }
}

/** BodyTrackerRecovering, matched by name (editorModel stays free of the lazily imported tracker module). */
export function isRecovering(e: unknown): boolean {
  return e instanceof Error && e.name === 'BodyTrackerRecovering';
}
const RECOVER_TRIES = 20;
const RECOVER_WAIT_MS = 500;

export const BODY_UNMEASURED_REASON = '無法量測人物輪廓，美體調整暫不可用';

/**
 * Where a new 增高 band starts for this person: hips → ankles (the legs), when those keypoints are clearly
 * visible; undefined → the panel's default band.
 */
export function suggestedBand(det: BodyDetection | null): { top: number; bottom: number } | undefined {
  if (!det) return undefined;
  const pt = det.pose.points;
  const y = (i: number) => pt[i * 4 + 1];
  const vis = (i: number) => pt[i * 4 + 3];
  if (![23, 24, 27, 28].every((i) => vis(i) > 0.6 && Number.isFinite(y(i)))) return undefined;
  const top = Math.max(0, (y(23) + y(24)) / 2);
  const bottom = Math.min(0.98, (y(27) + y(28)) / 2);
  return bottom - top >= 0.1 ? { top, bottom } : undefined;
}

/**
 * What the 美體 tab shows (panelModel BodyContext): status, model download progress, per-slider availability, the
 * body persons, 重試 after an error, whether 背景保護 has a person mask, and where a new 增高 band starts.
 */
export function bodyPanelContext(
  det: BodyDet,
  tracker: BodyTrackerState,
  measure: BodyMeasure | null,
  availability: (m: BodyMeasure | null, id: ParamId) => RegionStatus,
  retry?: () => void,
): BodyContext {
  const off = (reason: string) => () => ({ ok: false, reason });
  switch (det.phase) {
    case 'idle':
      return { status: 'idle', availability: off(BODY_LOADING_REASON), people: 0 };
    case 'working': {
      // the download has started but reported nothing yet → 0 %, so the note says 下載 rather than 偵測
      const progress = tracker.state === 'loading' && tracker.step === 'model' ? (tracker.progress ?? 0) : undefined;
      return { status: 'loading', progress, availability: off(BODY_LOADING_REASON), people: 0 };
    }
    case 'error':
      return { status: 'error', message: det.message, availability: off(det.message), people: 0, retry };
    case 'done': {
      if (!det.det) return { status: 'none', availability: off(BODY_NONE_REASON), people: 0 };
      const band = suggestedBand(det.det);
      const extra = band ? { suggestedBand: band } : {};
      // 背景保護 reads the measure's mask (buildBodyFieldV1): without a measure, or measured without a mask (the
      // CPU pose fallback has no segmentation), it would do nothing
      if (!measure) {
        return { status: 'ready', availability: off(BODY_UNMEASURED_REASON), people: det.det.people, hasMask: false, ...extra };
      }
      const hasMask = measure.mask !== null;
      return { status: 'ready', availability: (id) => availability(measure, id), people: measure.people, hasMask, ...extra };
    }
  }
}

/**
 * BodyContext.personGate (≥ 2 persons): a body item's gate by that person's own measure; a body person measurePersons
 * skipped (measureBody threw) reads BODY_UNMEASURED_REASON, as v0.3 did, never the lens's generic reason (step-1 review)
 */
export function personBodyGate(
  measures: ReadonlyMap<PersonId, BodyMeasure>,
  availability: (m: BodyMeasure | null, id: ParamId) => RegionStatus,
): (person: PersonId, id: ParamId) => RegionStatus {
  return (person, id) => {
    const m = measures.get(person);
    return m ? availability(m, id) : { ok: false, reason: BODY_UNMEASURED_REASON };
  };
}

/**
 * A 美體 detection's answer in two steps (step-1 review): `merge` (bodyAnswer, the rebase onto every stored state) is
 * the outcome, so only its failure is 美體偵測失敗 (重試 detects again); `notify` (the group-photo notices) runs after a
 * merge that worked, and a failure there is reported on its own: the bodies are merged already.
 */
export function settleBodyAnswer(merge: () => void, notify: () => void, report: (e: unknown, where: string) => string): { ok: true } | { ok: false; message: string } {
  try {
    merge();
  } catch (e) {
    return { ok: false, message: report(e, 'body answer') };
  }
  try {
    notify();
  } catch (e) {
    report(e, 'body notices');
  }
  return { ok: true };
}

/** What the debounced encode / autosave waits for (the Editor's encode effect, and its timer when it fires). */
export interface OutputWait {
  /** no session bound to the current engine */
  noSession: boolean;
  /** the WebGL context is lost: nothing to read back (the effect re-arms on restore) */
  lost: boolean;
  /** a tiled export runs: its GL buffers are tile-sized */
  exportBusy: boolean;
  /** a 推臉筆 stroke is live: the effect reads the `drawing` state, the timer the live stroke's ref */
  stroke: boolean;
  /** a chunked 推臉筆 rebuild is pending */
  rebuild: boolean;
  /** a 裁切 handle / move or 拉直 drag runs */
  geoDrag: boolean;
}

/**
 * The debounced encode / autosave waits (push-brush spec §3.5, step-3 §6.3); liquifyTick, fieldTick and the gesture's
 * commit re-arm it. The timer asks again when it fires, with the live stroke read from its ref (step-6 review): Preact
 * runs the cleanup that cancels a timer armed before the stroke only after the next frame, and the queue drain in that
 * frame already applied the stroke's first stamps, so the timer alone would snapshot half a stroke under the pre-stroke
 * editKey.
 */
export function outputWaits(w: OutputWait): boolean {
  return w.noSession || w.lost || w.exportBusy || w.stroke || w.rebuild || w.geoDrag;
}

/** What the debounced encode / autosave still owes the state on screen (the Editor's encode effect and its timer). */
export interface OutputOwed {
  /** the plan keeps a pre-encoded share file (preEncodes: a working-size JPEG) */
  preEncodes: boolean;
  /** the share file for these params, this 美體 field and these output settings is made already (shareReady) */
  shareReady: boolean;
  /** the stored thumbnail no longer shows what the editor draws (an answer's first faces, a flush that had no GL) */
  thumbOwed: boolean;
  /** these params and this field are what was last queued to history (stampIs(saved, …)) */
  saved: boolean;
}

/**
 * Nothing left to do: no share file to make, no thumbnail owed, the autosave queued. An owed thumbnail counts whatever
 * the plan, also when the share file is made already (a 儲存 tap inside the debounce, then a flush that found the
 * context lost: it kept the params without a thumbnail, crop spec §7), so the restore's re-run draws it.
 */
export function outputSettled(o: OutputOwed): boolean {
  return (!o.preEncodes || o.shareReady) && !o.thumbOwed && o.saved;
}

/**
 * The working-size image the timer renders before the autosave decides: 'encode' makes the share file (its image also
 * serves an owed thumbnail and the history write); 'thumb' renders it for an owed thumbnail of a saved entry when there
 * is no share file to make (a tiled or PNG plan, or the one for these params is made already); null: none (the
 * autosave renders its own when it writes).
 */
export function outputImage(o: OutputOwed & { entry: boolean }): 'encode' | 'thumb' | null {
  if (o.preEncodes && !o.shareReady) return 'encode';
  return o.thumbOwed && o.entry && o.saved ? 'thumb' : null;
}

/** long edge of a draft 美體 field (a drag step's preview): about a quarter of the full field's build cost */
export const BODY_DRAFT_LONG_EDGE = 128;

const objIds = new WeakMap<object, number>();
let objSeq = 0;
/** a stable number per object (measure / mask identity: a new detection is a new object) */
const objId = (o: object) => {
  let v = objIds.get(o);
  if (v === undefined) objIds.set(o, (v = ++objSeq));
  return v;
};

/**
 * What the multi-person field depends on (S §4.6 item 8): every edited person's values and measure, the masks, the
 * band, 長腿 with its anchor's measure, 背景保護 and the aspect.
 */
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

/**
 * The 美體 field, rebuilt only when its input changes (bodyInputKey): a skin or filter edit reuses it, so the engine does
 * not re-upload it. A drag step asks for a `draft` (built at BODY_DRAFT_LONG_EDGE; the field is in UV units, so any size
 * is a valid preview); the commit / an export asks again without it, which rebuilds the same input at full resolution.
 * A full field also answers a later draft request for the same input. The previous field is passed to the build (it may
 * refill the same buffer: `changed` then reads its version). `up` is the up-frame the field is built in (S §3.4): part of
 * the key, so a 旋轉 rebuilds the field and a 翻轉 (same upQuarter) does not; the previous field is handed to the build
 * only in the upright frame (an odd U grid has swapped sides).
 */
export class BodyFieldMemo {
  private key: string | null = null;
  private draft = false;
  field: BodyField | null = null;

  constructor(private readonly build: (input: BodyFieldInput, prev?: BodyField | null, longEdge?: number) => BodyField | null) {}

  /** changed → hand `field` to the session (it may be the same object with a new version). */
  update(input: BodyFieldInput, draft = false, up: Quarter = 0): { field: BodyField | null; changed: boolean } {
    const key = `${bodyInputKey(input)}|${up}`;
    if (key === this.key && (draft || !this.draft)) return { field: this.field, changed: false };
    const before = this.field;
    const beforeVersion = before?.version;
    const prev = up === 0 ? before : null;
    this.field = draft ? this.build(input, prev, BODY_DRAFT_LONG_EDGE) : this.build(input, prev);
    this.key = key;
    this.draft = draft && this.field !== null;
    return { field: this.field, changed: this.field !== before || this.field?.version !== beforeVersion };
  }
}

/**
 * Decides whether the Editor's 美體 field effect builds the full field now or a draft in a later frame. Only a
 * drag step's own params change may take the draft path: the Editor re-arms the encode / autosave on a full
 * field (fieldTick) and relies on the params change to re-arm it for a draft, so a draft built for anything else
 * (a measure change: the detection arriving, the session face changing) would leave the preview on the draft and
 * the share file / history entry on the older field until the next edit.
 *
 * States (`dragging`, the measure the field was last asked for):
 * - noteUpdate(commit=false) (a drag step)        → dragging
 * - noteUpdate(commit=true) / noteFull()          → not dragging (a commit, undo / redo, or a full build that
 *   replaced any pending draft, e.g. settleField: a gesture that never commits, such as the 增高 overlay
 *   unmounted mid-drag, cannot leave the flag set past the next full build; the next real drag step sets it)
 * - next(measure): 'draft' only while dragging AND the measure is the one seen last; otherwise 'full'. It records
 *   the measure, so every measure change is answered by exactly one full build.
 * Nothing here schedules anything, so it cannot loop: each effect run asks once, and a pending draft frame asks
 * `draft` once when it runs.
 */
export class FieldDraftGate {
  private dragging = false;
  /** (nothing seen yet: the first effect run builds full, and it does anyway with no drag) */
  private measure: unknown = undefined;

  /** a params update: commit=false is a drag step */
  noteUpdate(commit: boolean): void {
    this.dragging = !commit;
  }

  /** undo / redo, or a full field replaced whatever draft was pending */
  noteFull(): void {
    this.dragging = false;
  }

  /** a pending draft frame: still a drag step's draft (else build full) */
  get draft(): boolean {
    return this.dragging;
  }

  /** the field effect ran for (measure, params) */
  next(measure: unknown): 'full' | 'draft' {
    const measureChanged = measure !== this.measure;
    this.measure = measure;
    return this.dragging && !measureChanged ? 'draft' : 'full';
  }
}

/**
 * What an encoded share file or a history write was rendered from: the params (keyOf) and the generation of the
 * 美體 field the session held. The field can change without any params change (the detection arriving, a
 * drag's full-resolution rebuild), and the exported pixels follow it. ANY_FIELD: a reopened entry, saved with
 * whatever field it had then (viewing it rebuilds the field from the cached detection: nothing to write).
 */
export interface OutputStamp {
  key: string;
  field: number;
}
export const ANY_FIELD = -1;

/** `stamp` was made from these params and this field generation. */
export function stampIs(stamp: OutputStamp | null | undefined, key: string, field: number): boolean {
  return !!stamp && stamp.key === key && (stamp.field === ANY_FIELD || stamp.field === field);
}

// ───────────────────────── persons (S §3.3) ─────────────────────────

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

/**
 * The lens's per-person 美體 gate (S §2.4 "Availability under 全部"): that person's own measure decides. A body person
 * without one (measureBody threw, so measurePersons skipped it) can use no local item: fieldInputOf lists measured
 * persons only, so a write to it would move nothing (a dead slider, Review Focus #2; v0.3 disabled these items with
 * BODY_UNMEASURED_REASON).
 */
export function measuredAvailable(
  measures: ReadonlyMap<PersonId, BodyMeasure>,
  person: PersonId,
  id: ParamId,
  availability: (m: BodyMeasure, id: ParamId) => RegionStatus,
): boolean {
  const m = measures.get(person);
  return !!m && availability(m, id).ok;
}

/** the 長腿 anchor (S §4.6): legsAnchor with a body, else the primary with a body, else the best-scoring body person */
export function legsAnchorOf(edit: EditState, cache: DetectionCache, measures: ReadonlyMap<PersonId, BodyMeasure>): PersonId | null {
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

/** the 美體 field's input (S §4.6): every measured body person, its local values, every mask, the bands and 長腿 */
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

// ───────────────────────── the persons UI (S §2) ─────────────────────────

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

/**
 * hitPerson's context (S §2.3): face boxes per person, bodies on 美體, the body field, and the 44 pt minimum. The layer rect
 * shows V at the current zoom while the boxes are O-normalized: a 44 × 44 pt square at the tap is taken through the linear
 * part of `vToO` (the view: crop, 拉直, quarter turns, 翻轉) and its O extents are the minimum.
 */
export function hitCtxOf(cache: DetectionCache, bodies: boolean, field: BodyField | null, layer: { width: number; height: number }, vToO: Affine): HitCtx {
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
  const w = 44 / Math.max(1, layer.width);
  const h = 44 / Math.max(1, layer.height);
  return { faces, ...(bodyList ? { bodies: bodyList } : {}), field, minW: Math.abs(vToO.a) * w + Math.abs(vToO.c) * h, minH: Math.abs(vToO.b) * w + Math.abs(vToO.d) * h };
}
