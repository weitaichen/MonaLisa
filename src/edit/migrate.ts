// Reading a stored entry (lazy migration at open, RM §5.2, S §5.3): HistoryEntry → the edit to open with, the cache to
// trust, and what the first face answer merges or rematches (whether a detection runs is the editor's sessionPlan).
// Nothing is rewritten in bulk; the first write after an open writes v2.
// The answer-time half (pairing, the p0 hand-over, A13) is firstAnswer; a 美體 detection's is bodyAnswer (before the
// first face answer on preAnswerCache, S §7).
import { addFaceScan, aspectFits, boxScore, buildCache, cachedFits, noFaceCache, poseBox, rematchByIoU, withBodies, withFaces } from '../detect/cache';
import { adaptCached, EMPTY_PREPARED, type PreparedFaces } from '../detect/faces';
import { primaryOf, seedPrimary } from '../detect/persons';
import { cropConstrain, cropValid, isIdentity } from '../geometry/view';
import type { BodyDetections, CachedBody, CameraLook, DetectionCache, EditState, FaceSeed, HistoryEntry, LiquifyFrame, PersonId, PersonParams, Rect } from '../types';
import { editFromLegacy, mergeLegacy } from './legacy';
import { sanitizeStrokes } from './liquify';
import { assignPersons, neutralPerson, P0, renamePersons, sanitizeEditState, sanitizeGeometry, withPersons } from './state';

export interface V1Bodies {
  bodies: CachedBody[];
  complete: boolean;
}

export interface OpenedState {
  edit: EditState;
  /** a cache that fits this photo (used as is), or null */
  detect: DetectionCache | null;
  /** a dropped cache: old person id → face box (rematchByIoU) */
  rematch: Record<PersonId, Rect> | null;
  /** v1 body cache to merge at the first face answer; its person is the primary (A13) */
  v1Body: V1Bodies | null;
  /** the cache was dropped or lost persons: toast 已重新偵測臉部，部分人物的設定已重設 after the re-detect */
  cacheDropped: boolean;
  /** the size the 推臉筆 grid is built on: the entry's stored width × height (push-brush spec §3.3), never the decode size */
  frame: LiquifyFrame;
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

/**
 * The geometry as the editor draws it: validated against the stored size first (sanitizeGeometry, D13), then fitted to
 * the bitmap decoded now (step-3 review). The 2048 and 1440 tiers round the aspect apart (about 3e-4), which pushes a
 * max-fit crop at θ ≠ 0 past the rotated edge for the decode: cropModel's handles return their start while !cropFits, so
 * every one would be dead. cropConstrain moves or shrinks it by that rounding only; an equal size changes nothing.
 */
function fitToDecode(o: OpenedState, size: { width: number; height: number }): OpenedState {
  const g = o.edit.photo.geometry;
  if (!(size.width > 0 && size.height > 0) || isIdentity(g) || cropValid(g, size)) return o;
  return { ...o, edit: { ...o.edit, photo: { ...o.edit.photo, geometry: cropConstrain(g, size) } } };
}

export function openState(entry: HistoryEntry, size: { width: number; height: number }): OpenedState {
  return fitToDecode(openStored(entry, size), size);
}

function openStored(entry: HistoryEntry, size: { width: number; height: number }): OpenedState {
  const frame: LiquifyFrame = { width: entry.width, height: entry.height };
  const v2Edit = entry.schema === 2 ? entry.edit : undefined;
  const d = entry.detect;
  const fits = !!d && cachedFits(d, size.width, size.height);
  if (!v2Edit) {
    const edit = editFromLegacy(entry.params, { primaryInit: true });
    if (d && fits) {
      // defensive: 0.4 always writes `edit` together with `detect`
      const ids = d.persons.map((p) => p.id);
      return { edit: assignPersons(edit, ids, d.primary), detect: d, rematch: null, v1Body: null, cacheDropped: false, frame };
    }
    return { edit, detect: null, rematch: null, v1Body: v1BodiesOf(entry, size), cacheDropped: false, frame };
  }
  // the geometry and the strokes are validated against the stored size of `original` (step-3 spec §5, D13; push-brush
  // spec §3.3: never the decode size) on every v2 path, the ones that hand the stored edit back as it is included
  // (openState then fits the geometry to the decode: fitToDecode)
  let edit: EditState = {
    ...v2Edit,
    photo: { ...v2Edit.photo, geometry: sanitizeGeometry(v2Edit.photo.geometry, frame), strokes: sanitizeStrokes(v2Edit.photo.strokes, frame) },
  };
  if (entry.legacyEdited) {
    // 0.3 edited this entry after a rollback (normalizeEntry checked paramsKey against the stored params): what it
    // stored wins for the photo and the primary person. A cache that does not fit still names the primary its params
    // projected (its persons go to the rematch under their old ids).
    edit = mergeLegacy(edit, entry.params, d ? d.primary : P0, entry.legacyEdited);
  }
  if (d && fits) {
    // the persons of a dropped cache that a 美體 cache carries to the first face answer (its rematch, S §7) keep their
    // params in the edit until that answer renames them
    const pending = Object.keys(d.rematch ?? {}).filter((id) => id in edit.persons);
    return {
      edit: sanitizeEditState(edit, [...d.persons.map((p) => p.id), ...pending], frame),
      detect: d,
      rematch: null,
      v1Body: null,
      cacheDropped: entry.detectLost === true,
      frame,
    };
  }
  if (d || entry.staleBoxes) {
    // a cache that does not fit hands on its persons' face boxes and the rematch it still had pending (a 美體 cache
    // written before the first face answer, S §7), as staleBoxes does for a cache that cannot be read (S §5.4)
    const rematch = d ? { ...(d.rematch ?? {}), ...boxesOf(d) } : (entry.staleBoxes ?? {});
    return { edit, detect: null, rematch, v1Body: null, cacheDropped: true, frame };
  }
  return { edit, detect: null, rematch: null, v1Body: v1BodiesOf(entry, size), cacheDropped: false, frame };
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
  /** the cache the editor holds (a 基本模式 cache, or one a 美體 detection wrote before any face answer, to merge into), or null */
  detect: DetectionCache | null;
  /** the detection (null in 基本模式: no face answer) */
  prepared: PreparedFaces | null;
  size: { width: number; height: number };
  /** a v1 entry's body cache: merged when there is no cache yet (a cache already holds its bodies) */
  v1Body: V1Bodies | null;
  /** a dropped cache's face boxes (openState); a cache carries its own pending one (DetectionCache.rematch) */
  rematch: Record<PersonId, Rect> | null;
  faceSeed: FaceSeed;
  /** the up-frame the face detection ran in (step-3 spec §3.6); default 0 */
  quarter?: 0 | 1 | 2 | 3;
}
export interface Answer {
  detect: DetectionCache;
  /** apply to the current edit and to every undo state (UndoStack.rebase) */
  rebase: (e: EditState) => EditState;
  /** persons were renamed or reset by a rematch: show the cache-dropped toast */
  dropped: boolean;
}

const LOCAL_BODY = (k: string) => k.startsWith('body.') && k !== 'body.legs';

/**
 * `face`'s params with `body`'s nine local 美體 values: A13's hand-over merges one part of p0's look into a person's own
 * params (S §5.3 R2). Only the values differ; the shades, 左右分開 and the preset are face items (a preset never holds 美體)
 */
function withLocalBody(face: PersonParams, body: PersonParams): PersonParams {
  const values = { ...face.values };
  for (const k of Object.keys(values) as (keyof PersonParams['values'])[]) if (LOCAL_BODY(k)) values[k] = body.values[k];
  return { ...face, values };
}

/**
 * The persons a merge maps (S §5.3 R1): p0 (the look while nobody is known), the persons of the cache it merges into,
 * and the stored persons a pending rematch names. Anything else is a dropped cache's person without a face box, which
 * no answer can match (old persons without a match are dropped): it goes before the merge hands out ids, so no new
 * person reads its params, and its 長腿 anchor and spots go with it, as for an unmatched rematch
 */
function knownOnly(e: EditState, cache: DetectionCache | null, stale: Readonly<Record<PersonId, Rect>> | null): EditState {
  const known = new Set<PersonId>([P0, ...(cache?.persons.map((p) => p.id) ?? []), ...Object.keys(stale ?? {})]);
  const gone = Object.keys(e.persons).filter((id) => !known.has(id));
  return gone.length ? renamePersons(e, Object.fromEntries(gone.map((id) => [id, null]))) : e;
}

/** the params a faceless cache handed from p0 to its primary body person, back on p0 (persons only: the person keeps its id) */
function handBack(e: EditState, holder: PersonId): EditState {
  const look = e.persons[holder];
  if (!look || P0 in e.persons) return e;
  const persons = { ...e.persons };
  delete persons[holder];
  persons[P0] = look;
  return { ...e, persons };
}

/**
 * the persons a rematch renames first: renamePersons keeps the first claim, so a dropped cache's person keeps its stored
 * params over what this session gave the person it matches meanwhile (a body person of a 美體 cache that the face
 * answer pairs with its face, S §7); the edit lists those body persons first (bodyAnswer, sanitizeEditState)
 */
function staleFirst(e: EditState, rename: Readonly<Record<PersonId, PersonId | null>>): EditState {
  const persons: Record<PersonId, PersonParams> = {};
  for (const id of Object.keys(rename)) if (id in e.persons) persons[id] = e.persons[id];
  for (const [id, p] of Object.entries(e.persons)) if (!(id in persons)) persons[id] = p;
  return { ...e, persons };
}

/**
 * The first definite answer of a photo's face detection (S §3.3 item 4), and any face answer that merges into a cache
 * without faces (a 基本模式 cache, A15, or one a 美體 detection wrote before the first face answer, S §7): the cache, and
 * the mapping every stored edit goes through (assignPersons / renamePersons, applied to the current edit and to every
 * undo state).
 * - p0's look: on p0, or (a faceless cache with bodies) on the cache's primary body person, which p0 was handed to. Its
 *   body is b0 of A13: 0.3's body (v1Body) without a cache, else that person's body;
 * - primary: a camera seed's face (C2: a seed in no padded box → the score primary, and p0 is discarded); else the
 *   person owning b0 when it pairs with a face or no face exists (A13); else the best score;
 * - A13: when someone else is the primary, the look's face part is merged over the primary's own params (it keeps its
 *   own local 美體 values) and its nine local 美體 values over b0's person's (it keeps its face values); a person the
 *   rematch renamed holds a stored person's params and takes neither part (S §5.3 R2);
 * - a dropped cache is rematched by face-box IoU (S §5.3): the open's rematch, or the one the cache carries ({} too:
 *   `dropped`, the reset toast). The persons no answer can match go first (knownOnly, R1).
 * The one-shot inputs (v1Body, rematch, faceSeed) belong to the photo's first answer only: a later answer passes null
 * for them. A cache's own pending rematch is read from it (and dropped from the cache), first answer or not.
 */
export function firstAnswer(a: AnswerInput): Answer {
  // a later scan in another up-frame (a sideways photo, S §3.6) appends its quarter: the cache only grows
  const scans: DetectionCache['faceScans'] = a.prepared ? addFaceScan(a.detect?.faceScans ?? [], a.quarter ?? 0) : [];
  // the faceless cache's primary body person that holds p0's look (p0 handed over when the bodies came first)
  const holder = a.detect && !a.detect.faces.length ? a.detect.persons.find((p) => p.id === a.detect!.primary && p.body !== null) : undefined;
  const lookBody = holder ? holder.body : !a.detect && a.v1Body?.bodies.length ? 'b0' : null;
  const stale = a.rematch ?? a.detect?.rematch ?? null;
  let cache: DetectionCache;
  if (a.detect) cache = a.prepared ? withFaces(a.detect, a.prepared, scans) : { ...a.detect };
  else if (a.prepared || a.v1Body?.bodies.length) {
    cache = buildCache(a.size, a.prepared ?? EMPTY_PREPARED, a.v1Body?.bodies ?? null, { faceScans: scans, bodiesComplete: a.v1Body?.complete ?? true });
  } else cache = { ...noFaceCache(a.size.width, a.size.height, scans), bodies: a.v1Body ? [] : null };
  // this answer rematches them
  delete cache.rematch;
  const ids = cache.persons.map((p) => p.id);
  let discardP0 = false;
  /** a camera seed named the primary's face */
  let seeded = false;
  if (a.faceSeed && a.faceSeed !== 'all') {
    const f = seedPrimary(a.faceSeed, cache.faces);
    const owner = f ? cache.persons.find((p) => p.face === f) : undefined;
    if (owner) {
      cache = { ...cache, primary: owner.id };
      seeded = true;
    }
    // no padded box holds the seed: with faces, the look was meant for a face the editor cannot match (C2). With no face
    // at all, p0 is the all-skin person the camera drew too (globalSkin, live.ts liveFrame), so it keeps the look as in
    // v0.3; unless the seed lies outside the frame (the beautified face was not in the saved shot)
    else discardP0 = cache.faces.length > 0 || !inFrame(a.faceSeed);
  }
  // b0: the body p0's local 美體 values were drawn on. Its person is the primary when it pairs with a face, or when there
  // is no face at all (A13), unless a camera seed named the primary; when it found no face beside faces, the face score
  // decides (withFaces keeps a body primary: A13 does not)
  const b0 = lookBody ? cache.persons.find((p) => p.body === lookBody) : undefined;
  if (b0 && !seeded) {
    if (b0.face !== null || cache.faces.length === 0) cache = { ...cache, primary: b0.id };
    else if (cache.primary === b0.id) cache = { ...cache, primary: primaryOf(cache.persons, cache.faces, []) };
  }
  const primary = cache.primary;
  // someone else gets p0's face part: b0's person keeps p0's local 美體 values (the A13 split)
  const split = !!b0 && b0.id !== primary;
  const rename = stale ? rematchByIoU(stale, cache) : null;
  /** the persons the rematch renamed: each holds a stored person's params now, which the hand-over never touches (R2) */
  const restored = new Set(Object.values(rename ?? {}).filter((to): to is PersonId => to !== null));
  const rebase = (e: EditState): EditState => {
    // the look goes back on p0 first, so a 美體 cache's body person and a v1 body take the same hand-over below
    let out = knownOnly(holder ? handBack(e, holder.id) : e, a.detect, stale);
    if (rename) out = renamePersons(staleFirst(out, rename), rename);
    const assigned = assignPersons(out, ids, primary, { discardP0 });
    // b0's person is the primary: it takes the whole look (assignPersons), unless a seed discarded it
    if (!b0 || (!split && !discardP0)) return assigned;
    // the A13 hand-over: each part of the look merged over the person's own params from before this answer (a person
    // new to the edit: the template)
    const look = out.persons[P0] ?? out.primaryInit ?? out.template;
    const own = (id: PersonId) => out.persons[id] ?? out.template;
    const hand: Record<PersonId, PersonParams> = {};
    if (split && !discardP0 && !restored.has(primary)) hand[primary] = withLocalBody(look, own(primary));
    // a discarded look keeps the body edit made on b0: the 美體 values were the user's, on that body (C2 drops the face part)
    if (!restored.has(b0.id)) hand[b0.id] = withLocalBody(own(b0.id), look);
    return withPersons(assigned, Object.keys(hand), (_, id) => hand[id]);
  };
  return { detect: cache, rebase, dropped: stale !== null };
}

/** a seed inside the saved shot (C2 maps it unclamped: outside [0, 1]² the tracked face was cropped away) */
const inFrame = (s: { x: number; y: number }) => s.x >= 0 && s.x <= 1 && s.y >= 0 && s.y <= 1;

/**
 * The cache a 美體 detection merges into before the photo's first face answer (S §7: a tracker that cannot answer yet;
 * v0.3 never waited): the 基本模式 form, no face scan and nobody known, so the bodies join the persons exactly as a
 * 基本模式 photo's do (bodyAnswer: p0 hands over to the primary body person) and the cache is written like any other: a
 * reopen and a re-scan in a new up-frame read it. The face answer merges into it (firstAnswer, A15 with A13's hand-over).
 * A dropped cache's rematch still pending rides in it, and so do the persons it names (S §5.3).
 */
export function preAnswerCache(size: { width: number; height: number }, rematch: Record<PersonId, Rect> | null): DetectionCache {
  const c = noFaceCache(size.width, size.height, []);
  return rematch ? { ...c, rematch } : c;
}

/**
 * A 美體 detection's answer (S §3.3 item 6, §3.4 P4, §7): the bodies joined to the persons (withBodies), and the mapping
 * every stored edit goes through (renamePersons for a vanished body's person, then assignPersons, which adds the new
 * body-only persons from the template). The pairing reads the cache's own faces, adapted at the photo's size: exactly
 * what a session built from this cache holds (still.ts fromCache), so it needs no session. During an engine recovery
 * (or before the first session) there is none, and pairing against nothing would split every body off as a body-only
 * person, for good: person ids are immutable once persisted. The persons a pending rematch names stay as they are (their
 * ids reserved, withBodies); any other person the cache does not know is dropped first (knownOnly, S §5.3 R1).
 */
export function bodyAnswer(detect: DetectionCache, found: BodyDetections['bodies'], size: { width: number; height: number }): Omit<Answer, 'dropped'> {
  const faceOf = (id: string) => {
    const c = detect.faces.find((f) => f.id === id);
    return c ? adaptCached(c, size.width, size.height) : null;
  };
  const r = withBodies(detect, found, faceOf);
  const ids = r.cache.persons.map((p) => p.id);
  const pending = Object.keys(r.cache.rematch ?? {});
  return {
    detect: r.cache,
    rebase: (e) => {
      const out = renamePersons(knownOnly(e, detect, detect.rematch ?? null), r.renamed);
      return assignPersons(out, [...ids, ...pending.filter((id) => id in out.persons)], r.cache.primary);
    },
  };
}
