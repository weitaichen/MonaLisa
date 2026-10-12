// Editor face-detection / export / 美體 bookkeeping (spec §7.2.4, body research report §落地設計), kept pure so
// it can be unit-tested without a DOM.
import type { SessionFace } from '../app/still';
import type { BodyFieldInput, BodyPersonInput } from '../body/field';
import type { FrameFaceIn } from '../edit/frame';
import { personOf } from '../edit/state';
import { hasValue, paramsInGroup } from '../engine/params';
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
  ParamId,
  PersonId,
  Rect,
  RegionStatus,
  TrackerState,
} from '../types';
import { contourActiveValues, type ProtectRequest } from './faceProtectModel';
import { BODY_NONE_NOTE, BODY_WAIT_REASON, type BodyContext } from './panelModel';
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

// ───────────────────────── 美體 ─────────────────────────

/**
 * What the editor knows about the person in this photo:
 * idle → not asked yet · cache → reading the history entry's cached detection · working → pose model download /
 * graph creation / detection · done → a detection (null = nobody in the photo) · error → retryable failure.
 */
export type BodyDet =
  | { phase: 'idle' }
  | { phase: 'cache' }
  | { phase: 'working' }
  | { phase: 'done'; det: BodyDetection | null }
  | { phase: 'error'; message: string };

// (the panel gates every detection-driven slider itself until the status is 'ready': same words here)
export const BODY_NONE_REASON = BODY_NONE_NOTE;
export const BODY_LOADING_REASON = BODY_WAIT_REASON;

const BODY_DEFS = paramsInGroup('body');

/** The part of the params the 美體 field depends on (sliders, 背景保護, 增高 band). */
export function bodyParamsKey(p: BeautyParams): string {
  const band = p.heightBand;
  return JSON.stringify([BODY_DEFS.map((d) => p.values[d.id]), p.bodyProtect, band && [band.top, band.bottom, band.amount]]);
}

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

/** A cached detection belongs to this photo when it was taken at the same aspect (normalized coordinates). */
export function cachedBodyFits(det: BodyDetection | null, width: number, height: number): boolean {
  if (!det) return true;
  if (!(width > 0 && height > 0)) return false;
  return Math.abs(det.width / det.height / (width / height) - 1) < 0.01;
}

/** Measure the detected person; a measure that throws only disables the detection-driven sliders. */
export function measureSafe(
  det: BodyDet,
  face: Face | null,
  measure: (d: BodyDetection, f: Face | null) => BodyMeasure,
  onError: (e: unknown) => void,
): BodyMeasure | null {
  if (det.phase !== 'done' || !det.det) return null;
  try {
    return measure(det.det, face);
  } catch (e) {
    onError(e);
    return null;
  }
}

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
 * What the 美體 tab shows (panelModel BodyContext): status, model download progress, per-slider availability,
 * the 2+ people hint, 重試 after an error, whether 背景保護 has a person mask, and where a new 增高 band starts.
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
    case 'cache':
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

/** long edge of a draft 美體 field (a drag step's preview): about a quarter of the full field's build cost */
export const BODY_DRAFT_LONG_EDGE = 128;

/**
 * The 美體 field, rebuilt only when the body subset of the params (sliders / band / 背景保護) or the measure
 * changes: a skin or filter edit reuses it, so the engine does not re-upload it. A drag step asks for a `draft`
 * (built at BODY_DRAFT_LONG_EDGE; the field is in UV units, so any size is a valid preview); the commit / an
 * export asks again without it, which rebuilds the same params at full resolution. A full field also answers a
 * later draft request for the same params.
 */
export class BodyFieldMemoV1 {
  private key: string | null = null;
  private measure: BodyMeasure | null = null;
  private draft = false;
  field: BodyField | null = null;

  constructor(
    private readonly build: (
      m: BodyMeasure | null,
      p: BeautyParams,
      aspect: number,
      prev?: BodyField | null,
      longEdge?: number,
    ) => BodyField | null,
  ) {}

  /** changed → hand `field` to the session (it may be the same object with a new version). */
  update(
    measure: BodyMeasure | null,
    params: BeautyParams,
    aspect: number,
    draft = false,
  ): { field: BodyField | null; changed: boolean } {
    const key = `${bodyParamsKey(params)}|${aspect}`;
    if (key === this.key && measure === this.measure && (draft || !this.draft)) return { field: this.field, changed: false };
    const before = this.field;
    const beforeVersion = before?.version;
    this.field = draft
      ? this.build(measure, params, aspect, before, BODY_DRAFT_LONG_EDGE)
      : this.build(measure, params, aspect, before);
    this.key = key;
    this.measure = measure;
    this.draft = draft && this.field !== null;
    const changed = this.field !== before || this.field?.version !== beforeVersion;
    return { field: this.field, changed };
  }
}

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

/** BodyFieldMemoV1 for the multi-person input: the same draft / full rules, keyed on bodyInputKey */
export class BodyFieldMemo {
  private key: string | null = null;
  private draft = false;
  field: BodyField | null = null;

  constructor(private readonly build: (input: BodyFieldInput, prev?: BodyField | null, longEdge?: number) => BodyField | null) {}

  /** changed → hand `field` to the session (it may be the same object with a new version). */
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

/**
 * The detection to cache in the history entry, or undefined when there is nothing (new) to store: not
 * detected yet, failed, or already stored (a cached one read back counts as stored).
 */
export function bodyToPersist(det: BodyDet, stored: boolean): BodyDetection | null | undefined {
  if (stored || det.phase !== 'done') return undefined;
  return det.det;
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
