// Reading a stored entry (lazy migration at open, RM §5.2, S §5.3): HistoryEntry → the edit to open with, the cache to
// trust, and what detection is still owed. Nothing is rewritten in bulk; the first write after an open writes v2.
// The answer-time half (pairing, the p0 hand-over, A13) is firstAnswer (Task 21).
import { aspectFits, boxScore, cachedFits, poseBox, scanned0 } from '../detect/cache';
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
