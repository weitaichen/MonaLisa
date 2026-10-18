// The detection cache of one photo (RM §3.6, S §3.2, §5.4): faces, obstacles, bodies and the persons built from them,
// all in normalized O-space, stored in HistoryEntry.detect so a reopen runs no detector. This file validates a stored
// cache, answers questions about it, and builds and merges it (buildCache, withFaces, withBodies, rematchByIoU).
import { MAX_EDIT_BODIES, MAX_EDIT_FACES, MAX_OBSTACLES, MAX_RENDER_FACES } from '../config/limits';
import { P0_INFO, type PersonInfo } from '../edit/lens';
import type {
  BodyDetection,
  BodyDetections,
  CachedBody,
  CachedFace,
  CachedObstacle,
  DetectionCache,
  Face,
  FaceScanRecord,
  PersonId,
  PersonInfoCached,
  PersonMask,
  Pose33,
  Rect,
} from '../types';
import { boxIoU, sameHead, type HeadLike, type PreparedFace, type PreparedFaces } from './faces';
import { pairPersons, primaryOf } from './persons';

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/** f0…f{MAX_RENDER_FACES − 1} (S §6.7: f0…f9): prepareFaces numbers at most MAX_EDIT_FACES ≤ MAX_RENDER_FACES */
const FACE_ID = new RegExp(`^f[0-${MAX_RENDER_FACES - 1}]$`);
const BODY_ID = /^b[0-3]$/;
/** every body id a cache can hold, in the order new bodies take them */
const BODY_IDS: readonly string[] = Array.from({ length: MAX_EDIT_BODIES }, (_, j) => `b${j}`);
const PERSON_ID = new RegExp(`^(f[0-${MAX_RENDER_FACES - 1}]|b[0-3]|p0)$`);

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

/** a stored cache's pending rematch (DetectionCache.rematch): readable boxes under person ids, p0 never */
function rematchOf(raw: unknown): Record<PersonId, Rect> {
  const out: Record<PersonId, Rect> = {};
  if (!isRecord(raw)) return out;
  for (const [id, b] of Object.entries(raw)) {
    const box = normBox(b);
    if (box && PERSON_ID.test(id) && id !== 'p0') out[id] = box;
  }
  return out;
}

/**
 * face boxes of the raw record's persons that are still readable (the rematch input of a dropped cache), plus the
 * rematch it still had pending (a dropped cache's persons a 美體 cache carried, S §7)
 */
function staleBoxesOf(r: Record<string, unknown>): Record<PersonId, Rect> | null {
  const boxes = new Map<string, Rect>();
  for (const f of arr(r.faces)) {
    if (isRecord(f) && typeof f.id === 'string') {
      const b = normBox(f.box);
      if (b) boxes.set(f.id, b);
    }
  }
  const out: Record<PersonId, Rect> = rematchOf(r.rematch);
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
 * be used at all returns null with `stale`: the face boxes of its persons (and of its pending `rematch`), for
 * rematchByIoU. A pending rematch keeps its readable boxes, except under an id the cache's own persons use (an empty one
 * stays: a cache was dropped all the same). Caches are never
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
  const scans = arr(raw.faceScans).filter(
    (s): s is { quarter: 0 | 1 | 2 | 3; flipH: boolean; detector?: unknown } => isRecord(s) && [0, 1, 2, 3].includes(s.quarter as number) && typeof s.flipH === 'boolean',
  );
  // a record's short-range flag lives only on a marked cache (step-1 spec §6.5); a marked one that flags none (written
  // before the records carried it) owes every record its full-range look, as the mark said then
  const marked = raw.photoDetector === 'short-range';
  const flagsNone = !scans.some((s) => s.detector === 'short-range');
  const faceScans: FaceScanRecord[] = scans.map((s) =>
    marked && (flagsNone || s.detector === 'short-range') ? { quarter: s.quarter, flipH: s.flipH, detector: 'short-range' } : { quarter: s.quarter, flipH: s.flipH },
  );
  // quarters the 美體 detection ran in (S §3.6, D5): only distinct integers 0–3, else dropped (absent = [0])
  const bs = raw.bodyScans;
  const bodyScans =
    Array.isArray(bs) && bs.every((x) => x === 0 || x === 1 || x === 2 || x === 3) && new Set(bs).size === bs.length ? ([...bs] as (0 | 1 | 2 | 3)[]) : undefined;
  const dropped = isRecord(raw.dropped) ? raw.dropped : {};
  const count = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : 0);
  /**
   * the pending rematch, without the ids this cache's own persons use (never both: withBodies reserves them). An empty
   * one is kept: {} still says a cache was dropped, so the face answer that resolves it shows the reset toast (S §5.4)
   */
  const pending = (persons: readonly PersonInfoCached[]) => {
    if (!isRecord(raw.rematch)) return {};
    const r = rematchOf(raw.rematch);
    for (const p of persons) delete r[p.id];
    return { rematch: r };
  };
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
    ...(bodyScans ? { bodyScans } : {}),
    // the answer came from the short-range detector standing in for full-range (step-1 spec §6.5); anything else: absent
    ...(raw.photoDetector === 'short-range' ? { photoDetector: 'short-range' as const } : {}),
  };
  if (!faces.length && !bodies?.length) {
    // p0 only in the stored no-face form (faces = [], bodies null or []). A record whose faces or bodies were all
    // dropped as corrupt is not "nobody here": it is dropped, so the photo re-detects and rematches by its stale boxes.
    const storedEmpty = Array.isArray(raw.faces) && !raw.faces.length && (raw.bodies === null || (Array.isArray(raw.bodies) && !raw.bodies.length));
    if (!storedEmpty) return fail();
    return { cache: { ...base, persons: [{ id: 'p0', face: null, body: null }], primary: 'p0', ...pending([]) }, stale: null, lost };
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
  return { cache: { ...base, persons, primary, ...pending(persons) }, stale: null, lost };
}

/** a detection taken at takenW × takenH belongs to a width × height photo: same aspect within 1 % (editorModel.ts:148-152) */
export function aspectFits(takenW: number, takenH: number, width: number, height: number): boolean {
  if (!(width > 0 && height > 0)) return false;
  return Math.abs(takenW / takenH / (width / height) - 1) < 0.01;
}

/** the cache was taken at this photo's aspect (normalized coordinates fit any decode size; RM §5.2) */
export function cachedFits(cache: DetectionCache, width: number, height: number): boolean {
  return aspectFits(cache.width, cache.height, width, height);
}

/** a definite upright face answer exists (faceScans holds {0, false}; [] = 基本模式) */
export function scanned0(cache: DetectionCache): boolean {
  return cache.faceScans.some((s) => s.quarter === 0 && !s.flipH);
}

/**
 * a scan counts for both flip states (a mirror does not change detectability), so it is recorded with flipH false. The
 * detector that answered it, when given: a short-range answer flags the record (FaceScanRecord.detector), and an answer
 * for a quarter already recorded replaces its record (a full-range one clears the flag), moved last as the newest answer
 * (a cache with faces found them in its last record, completionOf); none given keeps the record as it is
 */
export function addFaceScan(scans: DetectionCache['faceScans'], q: 0 | 1 | 2 | 3, detector?: 'full-range' | 'short-range' | null): DetectionCache['faceScans'] {
  const rec: FaceScanRecord = detector === 'short-range' ? { quarter: q, flipH: false, detector } : { quarter: q, flipH: false };
  if (!scans.some((x) => x.quarter === q)) return [...scans, rec];
  return detector ? [...scans.filter((x) => x.quarter !== q), rec] : [...scans];
}

/** the record still owes the completion a full-range look (only on a marked cache) */
export const shortScan = (s: FaceScanRecord): boolean => s.detector === 'short-range';

/** the records without their short-range flags: what a cache keeps once its mark is gone */
export const plainScans = (scans: readonly FaceScanRecord[]): FaceScanRecord[] => scans.map((s) => ({ quarter: s.quarter, flipH: s.flipH }));

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

/**
 * v0.3's choice among the detected bodies (selectPerson: the first best score) as the v1 shape: the single-body view of
 * the bench and the b3 harness
 */
export function primaryBody(d: BodyDetections | null): BodyDetection | null {
  if (!d || !d.bodies.length) return null;
  const best = d.bodies.reduce((a, b) => (b.score > a.score ? b : a));
  return { pose: best.pose, mask: best.mask, people: d.bodies.length, width: d.width, height: d.height };
}

const centreX = (b: Rect) => b.x + b.w / 2;
const centreY = (b: Rect) => b.y + b.h / 2;
/** display order (S §2.1): box centre x, y breaking ties within 0.01 (as prepareFaces orders faces) */
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
    // buildCache knows no bodyScans: a "nobody" body answer keeps the up-frames it was tried in (S D5)
    const built = buildCache({ width: cache.width, height: cache.height }, prepared, cache.bodies, { faceScans, bodiesComplete: cache.bodiesComplete });
    return cache.bodyScans ? { ...built, bodyScans: cache.bodyScans } : built;
  }
  const pairs = pairPersons(prepared.faces, cache.bodies, cache.width / cache.height);
  const faceOfBody = new Map(pairs.map(([f, b]) => [b, f]));
  const persons: PersonInfoCached[] = cache.persons.map((p) => (p.body && faceOfBody.has(p.body) ? { ...p, face: faceOfBody.get(p.body)! } : p));
  const linked = new Set(persons.map((p) => p.face).filter((x): x is string => x !== null));
  for (const f of prepared.faces) if (!linked.has(f.id)) persons.push({ id: f.id, face: f.id, body: null });
  const faces = prepared.faces.map((f) => ({ id: f.id, lm: f.lm, box: f.box }));
  return {
    ...cache,
    faceScans,
    faces,
    obstacles: prepared.obstacles,
    persons,
    dropped: prepared.dropped,
    primary: cache.primary === 'p0' ? primaryOf(persons, faces, cache.bodies) : cache.primary,
  };
}

const isFace = (o: CachedObstacle | PreparedFace): o is PreparedFace => 'face' in o;

/**
 * A cache whose faces the short-range detector found because the full-range one was not there (photoDetector
 * 'short-range', step-1 spec §6.5) gains what a full-range detection of the photo finds, without touching anything it
 * holds: every cached face keeps its id, box and landmarks, every person its id and links, the obstacles that are not
 * a face now and the primary stay, so no stored edit needs a rename (the editor only adds the new persons from the
 * template, assignPersons). A found face that is a cached one is skipped: one on a cached face's head (faces.ts sameHead:
 * their landmarks nearly coincide, however the two detectors box that head), so a face full-range misses (a close-up, a
 * cut-off edge) stays as well, and nothing is added twice. The others, largest first, take the lowest free face ids
 * (f0…f{MAX_RENDER_FACES − 1}) until the photo holds MAX_EDIT_FACES; the rest become obstacles and count as over the
 * cap. A new face that pairs with a body-only person links to it (that person keeps its id and params, as withFaces
 * does for a 基本模式 cache, A15); the others are appended as persons.
 * Faces stay in display order; the mark is cleared. Every cached obstacle stays but one a new face is (sameHead: an
 * obstacle has no landmarks, so boxed as that face, IoU > 0.6), so whatever bounded a face's warp cap still does. The
 * detection's obstacles and the faces without room join them (each once, none on a face's head), so a completion that
 * adds nobody can still bound a cap that was free and change the render: a face below MIN_FACE_FRAC, or past the cap,
 * that short-range missed (the editor owes the thumbnail then, and says a face is over the cap: editorModel.ts
 * completionShows; round 5: round 4's doc said such a completion left every cap as it was). `added`: the new face ids.
 * The caller's detection must have run where the cached faces were found (the cache's last face scan: a cache with
 * faces is never scanned again), so the cached landmarks and the found ones are in one frame, z included.
 */
export function withMoreFaces(cache: DetectionCache, found: PreparedFaces): { cache: DetectionCache; added: string[] } {
  const same = (a: HeadLike, b: HeadLike) => sameHead(a, b, cache.width, cache.height);
  const fresh = found.faces.filter((f) => !cache.faces.some((c) => same(c, f))).sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h);
  const taken = new Set<string>([...cache.faces.map((f) => f.id), ...cache.persons.map((p) => p.id), ...Object.keys(cache.rematch ?? {})]);
  const free = Array.from({ length: MAX_RENDER_FACES }, (_, i) => `f${i}`).filter((id) => !taken.has(id));
  const room = Math.max(0, Math.min(MAX_EDIT_FACES - cache.faces.length, free.length));
  const kept = fresh.slice(0, room).sort((a, b) => byPosition(a.box, b.box));
  const over = fresh.slice(room);
  const added = kept.map((f, i) => ({ ...f, id: free[i] }));
  const faces: CachedFace[] = [...cache.faces, ...added.map((f) => ({ id: f.id, lm: f.lm, box: f.box }))].sort((a, b) => byPosition(a.box, b.box));
  // a body-only person whose body a new face pairs with takes that face (its id and params stay)
  const bodyOnly = cache.persons.filter((p) => p.face === null && p.body !== null);
  const pairs = bodyOnly.length && cache.bodies ? pairPersons(added, cache.bodies.filter((b) => bodyOnly.some((p) => p.body === b.id)), cache.width / cache.height) : [];
  const faceOfBody = new Map(pairs.map(([f, b]) => [b, f]));
  const persons: PersonInfoCached[] = cache.persons.map((p) => (p.face === null && p.body && faceOfBody.has(p.body) ? { ...p, face: faceOfBody.get(p.body)! } : p));
  const linked = new Set(persons.map((p) => p.face));
  for (const f of added) if (!linked.has(f.id)) persons.push({ id: f.id, face: f.id, body: null });
  // obstacles: the cached ones, each still no face, unless a new face is it (an obstacle on a face's head would bound
  // that face's own cap, §4.1); then the detection's and the faces without room, each once and none on a face's head
  const heads: HeadLike[] = [...cache.faces, ...added];
  const obstacles: CachedObstacle[] = cache.obstacles.filter((o) => !added.some((f) => same(f, o)));
  for (const o of [...found.obstacles, ...over]) {
    if (heads.some((f) => same(f, o)) || obstacles.some((x) => same(x, o))) continue;
    obstacles.push(isFace(o) ? { box: o.box, oval: o.face.oval } : o);
  }
  const out: DetectionCache = {
    ...cache,
    faces,
    obstacles: obstacles.slice(0, MAX_OBSTACLES),
    persons,
    dropped: { tooSmall: Math.max(cache.dropped.tooSmall, found.dropped.tooSmall), overCap: found.dropped.overCap + over.length },
  };
  delete out.photoDetector;
  return { cache: out, added: added.map((f) => f.id) };
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

/** body detection: ids by centre x (a v1 b0 keeps its id when its pose matches), pairing, body-only persons appended */
export function withBodies(
  cache: DetectionCache,
  found: BodyDetections['bodies'],
  faceOf: (faceId: string) => Face | null,
): { cache: DetectionCache; renamed: Record<PersonId, PersonId | null> } {
  const renamed: Record<PersonId, PersonId | null> = {};
  // ids: an old body (a v1 b0, bodiesComplete false) keeps its id when its pose matches (< 0.05); the others get the
  // lowest b<j> no old body used, by centre x, then (only to stay within b0…b3) an unmatched old body's id. The ids of a
  // pending rematch are reserved until the face answer resolves them (S §5.3 R1): its stored persons are still in the
  // edit, so a body person under one of them would read their params. More new bodies than free ids: the extra ones
  // with the lowest score (selectPerson's) are dropped, never given a reserved id
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
  const matched = new Set(ids.values());
  const oldIds = new Set(old.map((o) => o.id));
  const reserved = new Set(Object.keys(cache.rematch ?? {}));
  const free = BODY_IDS.filter((id) => !matched.has(id) && !reserved.has(id));
  const pool = [...free.filter((id) => !oldIds.has(id)), ...free.filter((id) => oldIds.has(id))];
  const added = sorted.filter((b) => !ids.has(b));
  const kept = new Set([...added].sort((a, b) => b.score - a.score).slice(0, pool.length));
  let next = 0;
  for (const b of added) if (kept.has(b)) ids.set(b, pool[next++]);
  const bodies: CachedBody[] = sorted.filter((b) => ids.has(b)).map((b) => ({ id: ids.get(b)!, pose: b.pose, mask: b.mask, score: b.score }));
  // persons: a link survives only to a matched old body (a reused id is somebody else); a face person whose body
  // vanished keeps its face, a body-only person whose body vanished hands over (renamed)
  let persons: PersonInfoCached[] = [];
  for (const p of cache.persons) {
    if (p.id === 'p0') continue;
    if (p.body && !matched.has(p.body)) {
      if (p.face) persons.push({ ...p, body: null });
      else renamed[p.id] = null;
    } else persons.push(p);
  }
  const survivors = new Set(persons.map((p) => p.id));
  // pair the faces without a body with the bodies without a person
  const linkedBodies = new Set(persons.map((p) => p.body).filter((x): x is string => x !== null));
  const freeFaces = persons
    .filter((p) => p.face && !p.body)
    .map((p) => {
      const c = cache.faces.find((f) => f.id === p.face);
      const face = c ? faceOf(c.id) : null;
      return c && face ? { id: c.id, face, box: c.box } : null;
    })
    .filter((x): x is { id: string; face: Face; box: Rect } => x !== null);
  const freeBodies = bodies.filter((b) => !linkedBodies.has(b.id));
  for (const [f, b] of pairPersons(freeFaces, freeBodies, cache.width / cache.height)) {
    persons = persons.map((p) => (p.face === f ? { ...p, body: b } : p));
    linkedBodies.add(b);
  }
  for (const b of bodies) if (!linkedBodies.has(b.id)) persons.push({ id: b.id, face: null, body: b.id });
  // nobody known (a no-face photo where 美體 found no body either): p0 stays (S §3.3)
  if (!persons.length) persons.push({ id: 'p0', face: null, body: null });
  const primary = survivors.has(cache.primary) ? cache.primary : primaryOf(persons, cache.faces, bodies);
  // a vanished body-only person's params move on (S §7): the primary's to the new primary; any other's (the A13 split's
  // b0 beside faces) to the new primary body person, the best-scoring body-only person this detection added (the
  // body v0.3's selectPerson would edit among them). Never to a person that already holds params: renamePersons keeps
  // the first claim, so one person's values would silently replace the other's. Nobody left to take them: dropped.
  const taken = new Set<PersonId>([...survivors, primary]);
  for (const from of Object.keys(renamed)) {
    if (from === cache.primary) {
      renamed[from] = primary;
      continue;
    }
    const fresh = persons.filter((p) => !taken.has(p.id) && p.face === null && p.body !== null);
    if (!fresh.length) continue;
    const to = primaryOf(fresh, [], bodies);
    renamed[from] = to;
    taken.add(to);
  }
  return { cache: { ...cache, bodies, bodiesComplete: true, persons, primary }, renamed };
}

/** old person → new person by face-box IoU ≥ 0.5, greedy (S §5.3); unmatched old → null */
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
