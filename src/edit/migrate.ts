// Reading a stored entry (lazy migration at open, RM §5.2, S §5.3): HistoryEntry → the edit to open with, the cache to
// trust, and what detection is still owed. Nothing is rewritten in bulk; the first write after an open writes v2.
// The answer-time half (pairing, the p0 hand-over, A13) is firstAnswer.
import { aspectFits, boxScore, buildCache, cachedFits, noFaceCache, poseBox, rematchByIoU, scanned0, withFaces } from '../detect/cache';
import { EMPTY_PREPARED, type PreparedFaces } from '../detect/faces';
import { seedPrimary } from '../detect/persons';
import { stableKey } from '../store/undo';
import type { CachedBody, CameraLook, DetectionCache, EditState, FaceSeed, HistoryEntry, PersonId, PersonParams, Rect } from '../types';
import { editFromLegacy, splitLegacy } from './legacy';
import { assignPersons, neutralPerson, P0, renamePersons, sanitizeEditState, withPersons } from './state';

export interface V1Bodies {
  bodies: CachedBody[];
  complete: boolean;
}

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

/**
 * the v1 `body` cache as the bodies a first answer merges (b0 = the body 0.3 edited). A body taken at another aspect
 * is not this photo's (0.3's cachedBodyFits): null, so 美體 re-detects. Nothing re-checks it after the open.
 */
function v1BodiesOf(entry: HistoryEntry, size: { width: number; height: number }): V1Bodies | null {
  if (entry.body === undefined) return null;
  if (entry.body === null) return { bodies: [], complete: true };
  if (!aspectFits(entry.body.width, entry.body.height, size.width, size.height)) return null;
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
    return { edit, detect: null, needsFaceDetect: true, rematch: null, v1Body: v1BodiesOf(entry, size), cacheDropped: false };
  }
  let edit = v2Edit;
  if (entry.paramsKey !== undefined && entry.paramsKey !== stableKey(entry.params)) {
    // 0.3 edited this entry after a rollback: its params win for the photo and the primary person. A cache that does
    // not fit still names the primary its params projected (its persons go to the rematch under their old ids).
    const primary = d ? d.primary : P0;
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
  return { edit, detect: null, needsFaceDetect: true, rematch: null, v1Body: v1BodiesOf(entry, size), cacheDropped: false };
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
 * The one-shot inputs (v1Body, rematch, faceSeed) belong to the photo's first answer only: a later answer (a 基本模式
 * cache gaining faces, A15) passes null for them, or the A13 split would run again on persons that no longer hold p0.
 */
export function firstAnswer(a: AnswerInput): Answer {
  const scans: DetectionCache['faceScans'] = a.prepared ? [{ quarter: 0, flipH: false }] : [];
  let cache: DetectionCache;
  if (a.detect) cache = a.prepared ? withFaces(a.detect, a.prepared, scans) : a.detect;
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
  const rename = a.rematch ? rematchByIoU(a.rematch, cache) : null;
  const rebase = (e: EditState): EditState => {
    let out = rename ? renamePersons(e, rename) : e;
    if (split && b0) {
      const look = splitBodyLook(out.persons[P0] ?? out.primaryInit ?? out.template);
      out = assignPersons(out, ids, primary, { discardP0 });
      out = withPersons(out, [primary], () => look.face);
      return withPersons(out, [b0.id], () => look.body);
    }
    return assignPersons(out, ids, primary, { discardP0 });
  };
  return { detect: cache, rebase, dropped: a.rematch !== null };
}
