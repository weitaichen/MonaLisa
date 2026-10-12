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
