// Persons from faces and bodies (S §3.4 P4, §2.3): pairing, the primary, the camera seed, the camera hand-over's match
// (camera per-person spec §5.4) and the photo hit test.
// Pure and resolution-free (normalized O-space; iso distances divide y by the aspect).
import { fieldAt } from '../body/cpuWarp';
import { HANDOVER_IOU, SEED_BOX_PAD, TRACK_SIZE_JUMP } from '../config/limits';
import { maskCoversFace } from '../ui/faceProtectModel';
import type { BodyField, Face, PersonId, PersonInfoCached, PersonMask, Pose33, Rect } from '../types';
import { maskHit } from './bodyHit';
import { boxScore, poseBox } from './cache';
import { boxIoU } from './faces';

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

/** face id → body id pairs, greedy 1:1 by ascending cost (S §3.4 P4) */
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

/** the face whose box padded by SEED_BOX_PAD contains the seed (nearest centre among several), else null */
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

/**
 * A hand-over person's box is the captured frame's (K13): found at the shutter. A person held there (known missing: a
 * call that could see them missed them) or not refreshed on the captured frame and not known missing (`stale`: unseen
 * since a no-answer, round-3 review E5, or found before that frame and fed by no call on it, round-5 review: their
 * views had no answer there, or the call could not feed them, a find its view's edge cut or a face left to another
 * view, §7.1 I3) has a box that is the last answer's, a guess of where they were (matchHandOver's `guessed`, the
 * retries' owns in still.ts): a held one pairs only by box IoU; a stale one, not known missing, by box IoU, else, as
 * a found one, by the padded centre with a face of about its size (pairsByCentre, aboutSize; round-4 review F2,
 * round-6 review H3)
 */
export const onShutterFrame = (p: { held?: boolean; stale?: boolean }): boolean => !p.held && !p.stale;

/**
 * the box may pair by the padded centre with a face of about its size (matchHandOver's last rule, the retries' owns):
 * found at the shutter, or `stale` (not known missing); a held box (known missing: they may have left) only by box IoU
 * (round-2 review D6, round-4 review F2)
 */
export const pairsByCentre = (p: { held?: boolean; stale?: boolean }): boolean => onShutterFrame(p) || !!p.stale;

/**
 * a face of about the box's size: their widths within × TRACK_SIZE_JUMP, the tracker's own size gate (camera per-person
 * spec §7.3 item 3), so never D6's smaller stranger standing where they were (round-4 review F2), nor a found
 * neighbour's face of another size (round-6 review H4)
 */
export const aboutSize = (a: Rect, b: Rect): boolean => Math.max(a.w / b.w, b.w / a.w) <= TRACK_SIZE_JUMP;

/**
 * The camera hand-over's boxes (each camera person in the photo's UV) → the editor's faces (camera per-person spec §5.4,
 * K14), one to one, by the rules' strength first and the box's evidence next (round-3 review E4): every pair by box
 * IoU ≥ 0.3 (a face of the box's size in its place), the best first, the captured frame's boxes before the `guessed`
 * ones; only then, for the found and the `stale` boxes left (pairsByCentre; a held one never), by the padded-centre
 * rule of seedPrimary (a face whose box padded by SEED_BOX_PAD holds the box's centre) with a face of about the box's
 * size only (aboutSize), the nearest first, found or stale, a found box first at equal distance; other ties in the
 * input order (boxes, then faces, then obstacles). The `obstacles` (faces the editor's size filter or cap dropped) take part as
 * faces do, so a camera box on one is claimed by it and matches nothing: never the neighbour whose padded box holds its
 * centre (round-1 review C10). A box left over is missed: its person is dropped, never given another face.
 * Round-2 review D6: a held box gave its params by the padded centre to a smaller face, a far stranger the camera
 * never tracked, standing where they were. Round-3 review E4: round 2 ran the found boxes' centre rule before the held
 * boxes' IoU, so a found neighbour whose own face the editor missed took the face of a held person standing on it, at
 * IoU 0.94, by its centre. Round-4 review F2: a `stale` box (not known missing: believed still in the picture, its box
 * the last answer's) still left pairs by the padded centre too, with a face of about its size only; IoU alone dropped a
 * person who had moved a third of a face width while the tracker could not answer, and counted them missing
 * (「未偵測到臉部」) although 編輯 had found that face. Round-5 review G3: F2 ran the found boxes' centre pass before the
 * stale boxes', so a smaller found neighbour partly behind a stale person who had moved, whose own face the editor
 * missed, took that person's face by its centre (their face got the neighbour's params or 原圖, and they were counted).
 * Round-6 review H3: G3 still ran the found boxes' sized pass first, so a neighbour of that face's size did the same.
 * Within the centre rule the captured frame is no stronger evidence: a found box of a face's size at IoU under 0.3
 * with it, on the same pixels, is not on it, while a stale box may be that face moved; so the nearer box goes first,
 * either kind. H4: a found box paired by the plain
 * padded centre with a face of any size (a third of its width, or twice it), so a smaller neighbour partly behind a
 * held person who had moved, whose own face the editor missed, took that person's face (their params on it, uncounted,
 * and the neighbour's own face, never retried, at 原圖); a face not of the box's size is someone else's, as for the
 * tracker (§7.3 item 3), so the box is lost and its retry looks for its own face.
 * `pairs`: [box index, face id] in the order taken (the found boxes' IoU pairs, the guessed boxes', then the centre
 * pairs), never an obstacle; `missed`: the boxes paired with no face; `lost`: the indices of the boxes paired with
 * nothing, not even an obstacle (the ones the editor's retries ask for, still.ts).
 */
export function matchHandOver(
  boxes: readonly Rect[],
  faces: readonly { id: string; box: Rect }[],
  obstacles: readonly { box: Rect }[] = [],
  guessed: readonly boolean[] = [],
  stale: readonly boolean[] = [],
): { pairs: readonly [number, string][]; missed: number; lost: readonly number[] } {
  // an obstacle's key: no face id holds a NUL
  const all = [...faces.map((f) => ({ id: f.id, box: f.box })), ...obstacles.map((o, k) => ({ id: `\0${k}`, box: o.box }))];
  const usedB = new Set<number>();
  const usedF = new Set<string>();
  const paired: [number, string][] = [];
  /** `k`: the key, smaller first; `g`: at an equal key, 0 (a found box) before 1 (a guessed one) */
  const take = (cand: { i: number; f: string; k: number; g?: number }[]) => {
    // Array.prototype.sort is stable: equal keys keep the order they were listed in (boxes, then faces, then obstacles)
    cand.sort((a, b) => a.k - b.k || (a.g ?? 0) - (b.g ?? 0));
    for (const c of cand) {
      if (usedB.has(c.i) || usedF.has(c.f)) continue;
      usedB.add(c.i);
      usedF.add(c.f);
      paired.push([c.i, c.f]);
    }
  };
  const byIoU = (guess: boolean) => {
    const cand: { i: number; f: string; k: number }[] = [];
    boxes.forEach((b, i) => {
      if (!!guessed[i] !== guess) return;
      for (const f of all) {
        const iou = boxIoU(b, f.box);
        if (iou >= HANDOVER_IOU) cand.push({ i, f: f.id, k: -iou });
      }
    });
    take(cand);
  };
  /** the padded-centre rule with a face of about the box's size, for the found and the stale boxes left */
  const centred = () => {
    const cand: { i: number; f: string; k: number; g: number }[] = [];
    boxes.forEach((b, i) => {
      if (usedB.has(i) || !pairsByCentre({ held: !!guessed[i], stale: !!stale[i] })) return;
      const c: [number, number] = [b.x + b.w / 2, b.y + b.h / 2];
      for (const f of all) {
        if (usedF.has(f.id) || !inside(pad(f.box, SEED_BOX_PAD), c) || !aboutSize(b, f.box)) continue;
        cand.push({ i, f: f.id, k: Math.hypot(f.box.x + f.box.w / 2 - c[0], f.box.y + f.box.h / 2 - c[1]), g: guessed[i] ? 1 : 0 });
      }
    });
    take(cand);
  };
  // the rules by their strength: IoU, the captured frame's boxes first (E4); then the padded centre with a face of
  // about the box's size, found and stale boxes together, the nearest first (round-6 review H3, H4)
  byIoU(false);
  byIoU(true);
  centred();
  const pairs = paired.filter(([, f]) => !f.startsWith('\0'));
  return { pairs, missed: boxes.length - pairs.length, lost: boxes.flatMap((_, i) => (usedB.has(i) ? [] : [i])) };
}

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
  // 3. bodies: the highest mask value ≥ 128 wins, equal values → the smaller mask (bodyHit.ts, which 祛痘's owner shares)
  const masked = ctx.bodies.flatMap((b) => (b.mask ? [{ person: b.person, mask: b.mask }] : []));
  const hit = maskHit(src, masked);
  if (hit !== null) return hit;
  // 4. bodies without a mask: the smallest pose box, padded 5 %, that holds the point
  let body: PersonId | null = null;
  let bestArea = Infinity;
  for (const b of ctx.bodies) {
    if (b.mask || !inside(pad(b.box, 0.05), src)) continue;
    const area = b.box.w * b.box.h;
    if (area < bestArea) {
      bestArea = area;
      body = b.person;
    }
  }
  return body;
}
