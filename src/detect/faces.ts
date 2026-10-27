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

/** a duplicate detection of one face: box IoU over this (prepareFaces' step 3, the camera's T4) */
const DUPLICATE_IOU = 0.6;

/**
 * The MediaPipe FaceMesh landmarks sameHead compares: the eye corners (33, 133, 362, 263), the nose tip and the point
 * above it (1, 4), the nostrils (98, 327) and the mouth corners (61, 291). Both photo detectors' meshes of one head put
 * them within a small part of its eye span; a cut, hidden or extrapolated part of the face moves them least.
 */
const HEAD_MARKS = [33, 133, 362, 263, 1, 4, 98, 327, 61, 291] as const;
/** two faces boxed apart are one head when their HEAD_MARKS lie under this far apart on average, in eye spans (the larger one's) */
const SAME_MARKS = 0.18;
/** ... their nose tips (1) under this far apart, in eye spans */
const SAME_NOSE = 0.3;
/** ... and they are about one size: the larger eye span under this many times the smaller */
const SAME_SCALE = 1.5;
/** two faces boxed as one (IoU > DUPLICATE_IOU) are one head when their HEAD_MARKS lie under this far apart on average */
const BOXED_MARKS = 0.3;

/** what sameHead compares: a face's box, and its 478 × 3 landmarks when it has them (a found or cached face; an obstacle has none) */
export interface HeadLike {
  box: Rect;
  lm?: Float32Array;
}

/** the 3D distance in pixels between the outer eye corners (33, 263), z scaled as x is (MediaPipe's z: by the width) */
function eyeSpan(lm: Float32Array, width: number, height: number): number {
  return Math.hypot((lm[33 * 3] - lm[263 * 3]) * width, (lm[33 * 3 + 1] - lm[263 * 3 + 1]) * height, (lm[33 * 3 + 2] - lm[263 * 3 + 2]) * width);
}

/**
 * Two faces of a width × height photo, from its two detectors (BlazeFace full-range and the camera's short-range one,
 * step-1 spec §6.5), on one head. Faces with landmarks: their HEAD_MARKS nearly coincide, measured over the larger
 * face's eye span (eyeSpan) in 2D. Boxed apart, the marks' mean distance is under SAME_MARKS (0.18), the nose tips'
 * under SAME_NOSE (0.3) and the eye spans within SAME_SCALE (1.5) of each other; boxed as one (IoU > 0.6, which
 * prepareFaces merges within one detector's answer), the marks' mean is under BOXED_MARKS (0.3). A face without
 * landmarks (an obstacle, which keeps only its box and ring) is one head with another face or obstacle only at a box
 * IoU over 0.6, prepareFaces' own rule: its ring's centre is no nose (on the measured faces 0.19 of the ring's width
 * from the nose tip, up to 0.72), and a nose tested against a ring centre missed one head even with no other face near
 * it. So do faces whose eye span is 0 (no real mesh has one).
 *
 * Measured on both detectors' meshes, GPU and CPU (2026-10-18, the repo's own photos only: sample_face.png, the group
 * fixtures, group_people.jpg's yoga face, a blurry 50 px near-profile, and fullbody.jpg's masked man, composed as
 * close-ups, cut by every frame edge, beside each other and overlapping, 0–80 % of the face behind hidden, 0.6–1.25× its
 * size, a smaller face in front): one head's two meshes put the marks 0.10 eye spans apart at p99 (0.21 at most) and
 * their eye spans within 1.27 of each other when no face covers that head, boxed at IoU 0.63 or more; 0.19 apart at p99
 * (0.35 at most) when another face hides part of it. Different heads that do not overlap are 1.44 eye spans apart or
 * more. Where faces overlap, no distance between the noses tells them apart: a smaller face in front of a larger one's
 * nose puts the two noses 0.015–0.12 eye spans apart (its eye span 1.56–2.6 times smaller), a face of one size behind
 * another is meshed with its nose 0.18 eye spans from that face's (0.12 boxed as one face), and one head's two meshes,
 * 30–50 % hidden, differ by up to 0.27. All ten marks, with the size, do: of 1,580 overlapping different-head pairs the
 * rule merges 14, every one boxed as one face (IoU 0.61–0.73, which prepareFaces merges within one answer anyway: faces
 * of one size 43–73 % hidden, their marks 0.17–0.30 apart); of 4,968 same-head pairs it keeps 21 apart (16 in scenes
 * with the masked man or the near-profile, five of a child in front of the sample's face). The nose tips of the
 * same-head pairs merged boxed apart are 0.24 eye spans apart at most; the nose test costs none of them and keeps apart
 * two 3/4 views turned towards each other (the sample's mesh turned ±30–45°: the sample is turned about 19°, and
 * full-range found the near-profile alone in 3 of 96 scenes), whose other marks can lie closer than one head's. Round 3's box ellipse and round 4's ring centres, a
 * geometric guess at the nose, merged 750 of those 1,580 (round 5: a neighbour behind a cheek with its nose, an eye and
 * its mouth showing; a child's face in front of a parent's).
 */
export function sameHead(a: HeadLike, b: HeadLike, width: number, height: number): boolean {
  const iou = boxIoU(a.box, b.box);
  const la = a.lm;
  const lb = b.lm;
  if (!la || !lb) return iou > DUPLICATE_IOU;
  const sa = eyeSpan(la, width, height);
  const sb = eyeSpan(lb, width, height);
  const span = Math.max(sa, sb);
  if (!(Math.min(sa, sb) > 0)) return iou > DUPLICATE_IOU;
  const apart = (i: number) => Math.hypot((la[i * 3] - lb[i * 3]) * width, (la[i * 3 + 1] - lb[i * 3 + 1]) * height) / span;
  const marks = HEAD_MARKS.reduce((s, i) => s + apart(i), 0) / HEAD_MARKS.length;
  if (iou > DUPLICATE_IOU && marks < BOXED_MARKS) return true;
  return marks < SAME_MARKS && apart(1) < SAME_NOSE && span < SAME_SCALE * Math.min(sa, sb);
}

/** a cached face as the engine needs it (adapt at this decode's size: normalized, so any size works) */
export function adaptCached(c: CachedFace, width: number, height: number): Face {
  return adapt({ points: c.lm }, width, height);
}

/** prepareFaces' steps 1 and 2: the adapted face, its box and its landmarks; null for a non-finite or collapsed face */
function measure(l: Landmarks478, width: number, height: number): { face: Face; box: Rect; lm: Float32Array } | null {
  if (l.points.length < 478 * 3) return null;
  const lm = l.points.slice(0, 478 * 3);
  if (!lm.every(Number.isFinite)) return null;
  const face = adapt({ points: lm }, width, height);
  const box = ovalBox(face);
  if (!(box.w > 0 && box.h > 0)) return null;
  return { face, box, lm };
}

export function prepareFaces(lms: readonly Landmarks478[], width: number, height: number, cap = MAX_EDIT_FACES): PreparedFaces {
  // (1) adapt, (2) box; a non-finite or collapsed face never gets an id (Review Focus #1)
  const all: { face: Face; box: Rect; lm: Float32Array; area: number }[] = [];
  for (const l of lms) {
    const m = measure(l, width, height);
    if (m) all.push({ ...m, area: m.box.w * m.box.h });
  }
  // (3) a duplicate (IoU > 0.6) is the same face: keep the larger, drop the other entirely
  all.sort((a, b) => b.area - a.area);
  const unique: typeof all = [];
  for (const f of all) if (!unique.some((u) => boxIoU(u.box, f.box) > DUPLICATE_IOU)) unique.push(f);
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

/**
 * One detector's answer `lms` with the faces `over`, another detector's, in place of each of its faces on the same head
 * (sameHead), prepared afresh: prepareFaces' dedupe, size filter, cap, order and ids run on the union, so it is numbered
 * as a first answer is. The camera seed's union (D2, app/still.ts): a full-range answer and the short-range faces that
 * hold the seed, which full-range missed or boxed so far off that none of its padded boxes holds it. A full-range face
 * on that head is the same face, and the short-range one, which the seed selects, stands for it. So does one boxed as a
 * duplicate of it (IoU > 0.6) whose landmarks are elsewhere: prepareFaces keeps one face of the two whatever, and the
 * seed's is the one kept.
 */
export function prepareWith(lms: readonly Landmarks478[], over: readonly { box: Rect; face: Face; lm: Float32Array }[], width: number, height: number): PreparedFaces {
  const rest = lms.filter((l) => {
    const m = measure(l, width, height);
    return m !== null && !over.some((o) => sameHead(o, m, width, height) || boxIoU(o.box, m.box) > DUPLICATE_IOU);
  });
  return prepareFaces([...rest, ...over.map((o) => ({ points: o.lm }))], width, height);
}
