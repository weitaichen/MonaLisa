// 祛痘 spots (skin-cleanup spec §2.3, §3.3, §3.5, §5): the photo-level list, edited immutably, and its sanitizer; the
// tap planning (radius, regions, owner, snap, donor) on a patch of the working bitmap. Pure.
import { segDist } from '../body/geom';
import { SPOT_CAP } from '../config/limits';
import { maskHit } from '../detect/bodyHit';
import type { DetectionCache, EditState, Face, PersonId, PersonMask, Rect, Selection, Spot, SpotSize } from '../types';

/** what 清除 removes: one person's spots (清除此人) or every spot (全部清除) */
export type ClearScope = PersonId | 'all';

/** Appends `spot`; at SPOT_CAP the state is returned unchanged (the caller shows 祛痘點已達上限). */
export function addSpot(edit: EditState, spot: Spot): EditState {
  if (edit.photo.spots.length >= SPOT_CAP) return edit;
  return { ...edit, photo: { ...edit.photo, spots: [...edit.photo.spots, spot] } };
}

/** Removes the spots of `scope`; a clear that removes nothing returns `edit` itself (no undo step). */
export function clearSpots(edit: EditState, scope: ClearScope): EditState {
  const kept = scope === 'all' ? [] : edit.photo.spots.filter((s) => s.owner !== scope);
  if (kept.length === edit.photo.spots.length) return edit;
  return { ...edit, photo: { ...edit.photo, spots: kept } };
}

export function spotsInScope(edit: EditState, scope: ClearScope): number {
  return scope === 'all' ? edit.photo.spots.length : edit.photo.spots.filter((s) => s.owner === scope).length;
}

/** 清除此人 with one person of a group photo selected; 全部清除 otherwise (fewer than 2 persons, or 全部). */
export function clearScope(sel: Selection, selectablePersons: number): ClearScope {
  return sel.kind === 'person' && selectablePersons >= 2 ? sel.id : 'all';
}

/** Owners after a person rename (C §5.2 rematch); positions never change, they are in O. */
export function remapSpotOwners(spots: readonly Spot[], rename: (id: PersonId) => PersonId | null): Spot[] {
  return spots.map((s) => (s.owner === null ? s : { ...s, owner: rename(s.owner) }));
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * One stored spot, validated (§5): non-finite → dropped; centre outside [−0.01, 1.01] → dropped, else clamped to [0, 1];
 * r clamped to [0.0005, 0.04]; a donor farther than 0.2 → fill mode; an owner not in `personIds` → null.
 * `personIds` null means the persons are unknown, so every owner string is kept, as sanitizePhoto's `persons = null`
 * keeps legsAnchor. No caller reaches it today: sanitizeEditState always passes its persons' ids (with the detection
 * cache dropped, those of the stored persons, which the rematch then renames), and the one sanitizePhoto call with the
 * default (settings.ts, the camera look) has no O size, so sanitizeSpots returns [] first. It stays for that contract.
 */
export function sanitizeSpot(raw: unknown, personIds: ReadonlySet<PersonId> | null): Spot | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (!finite(s.x) || !finite(s.y) || !finite(s.r) || !finite(s.dx) || !finite(s.dy)) return null;
  if (s.x < -0.01 || s.x > 1.01 || s.y < -0.01 || s.y > 1.01) return null;
  const far = Math.hypot(s.dx, s.dy) > 0.2;
  const owner = typeof s.owner === 'string' && (personIds === null || personIds.has(s.owner)) ? s.owner : null;
  return {
    x: Math.min(1, Math.max(0, s.x)),
    y: Math.min(1, Math.max(0, s.y)),
    r: Math.min(0.04, Math.max(0.0005, s.r)),
    dx: far ? 0 : s.dx,
    dy: far ? 0 : s.dy,
    owner,
  };
}

/** The stored list: the first SPOT_CAP valid spots; none at all without an O size (the camera look, C §3.2). */
export function sanitizeSpots(raw: unknown, personIds: ReadonlySet<PersonId> | null, hasOSize: boolean): Spot[] {
  if (!hasOSize || !Array.isArray(raw)) return [];
  const out: Spot[] = [];
  for (const r of raw) {
    if (out.length >= SPOT_CAP) break;
    const s = sanitizeSpot(r, personIds);
    if (s) out.push(s);
  }
  return out;
}

// ── tap planning (S §2.3, §3.3–3.5) ──

export type V2 = [number, number];

/** 祛痘 大小: radius = k × the reference face width (S §2.3) */
export const SPOT_K: Record<SpotSize, number> = { S: 0.018, M: 0.03, L: 0.048 };

export interface SpotFace {
  /** the cached face id (f0…) */
  id: string;
  /** the adapted face, O-normalized */
  face: Face;
}
export type RegionKind = 'eye' | 'mouth' | 'lip' | 'skin' | 'other';
export interface Region {
  kind: RegionKind;
  face?: string;
}

const EYE: Record<'L' | 'R', readonly number[]> = { L: [52, 53, 72, 54, 55, 56, 73, 57], R: [58, 59, 75, 60, 61, 62, 76, 63] };
const INNER_LIP = [96, 97, 98, 99, 100, 101, 102, 103];
const OUTER_LIP = [84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95];

// "iso" coordinates: normalized O with y rescaled to width units (y / aspect), so distances are isotropic
const isoOf = (f: Face, i: number, aspect: number): V2 => [f.pts111[i * 2], f.pts111[i * 2 + 1] / aspect];
const isoPoly = (f: Face, idx: readonly number[], aspect: number): V2[] => idx.map((i) => isoOf(f, i, aspect));
const ovalIso = (f: Face, aspect: number): V2[] => Array.from({ length: f.oval.length / 2 }, (_, i): V2 => [f.oval[i * 2], f.oval[i * 2 + 1] / aspect]);
const dist = (a: V2, b: V2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** even-odd point-in-polygon test */
export function inPolygon(p: V2, poly: readonly V2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** inside `poly`, or within `d` of its outline (the polygon padded by `d`; a closed, zero-area ring keeps its band) */
function inPadded(p: V2, poly: readonly V2[], d: number): boolean {
  return inPolygon(p, poly) || poly.some((a, i) => segDist(p, a, poly[(i + 1) % poly.length]) <= d);
}

/** an iso polygon with its bounding box grown by `pad` (+ a hair, so the box test never rejects a point the exact test takes) */
interface IsoPoly {
  pts: V2[];
  pad: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
function isoShape(pts: V2[], pad = 0): IsoPoly {
  const e = pad + 1e-9;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { pts, pad, x0: x0 - e, y0: y0 - e, x1: x1 + e, y1: y1 + e };
}
const inBox = (q: V2, s: IsoPoly) => q[0] >= s.x0 && q[0] <= s.x1 && q[1] >= s.y0 && q[1] <= s.y1;
/** one face's regionAt polygons in iso coordinates: the padded eye rings, the inner and outer lips, the oval */
interface FaceRegions {
  id: string;
  eyes: IsoPoly[];
  inner: IsoPoly;
  outer: IsoPoly;
  oval: IsoPoly;
}
interface RegionIndex {
  aspect: number;
  faces: FaceRegions[];
}

/** every face's iso polygons, built once per planSpot or ownerAt call instead of once per point (the §3.4 CPU budget) */
function regionIndex(faces: readonly SpotFace[], aspect: number): RegionIndex {
  return {
    aspect,
    faces: faces.map(({ id, face }) => ({
      id,
      eyes: (['L', 'R'] as const).map((side) => {
        const ring = isoPoly(face, EYE[side], aspect);
        return isoShape(ring, 0.15 * dist(ring[0], ring[4]));
      }),
      inner: isoShape(isoPoly(face, INNER_LIP, aspect)),
      outer: isoShape(isoPoly(face, OUTER_LIP, aspect)),
      oval: isoShape(ovalIso(face, aspect)),
    })),
  };
}

/** regionAt on a prebuilt index; the boxes only skip polygons that cannot hold the point */
function regionIn(ix: RegionIndex, o: V2): Region {
  const q: V2 = [o[0], o[1] / ix.aspect];
  for (const f of ix.faces) {
    for (const e of f.eyes) if (inBox(q, e) && inPadded(q, e.pts, e.pad)) return { kind: 'eye', face: f.id };
    if (inBox(q, f.inner) && inPolygon(q, f.inner.pts)) return { kind: 'mouth', face: f.id };
  }
  for (const f of ix.faces) {
    if (inBox(q, f.outer) && inPolygon(q, f.outer.pts)) return { kind: 'lip', face: f.id };
    if (inBox(q, f.oval) && inPolygon(q, f.oval.pts)) return { kind: 'skin', face: f.id };
  }
  return { kind: 'other' };
}

/**
 * Where an O point lies (S §3.3): an eye ring padded by 0.15 eye width → eye; the inner lips → mouth; the outer lips
 * minus the inner → lip; the oval → skin of that face; anything else → other. Eyes and mouths of every face win first.
 * The eye padding is a distance band round the ring, so it is 0.15 eye width at any openness: a squint or a closed eye
 * keeps its lash line in the eye (the §2.3 refusal and the §3.5 donor rim rule).
 */
export function regionAt(o: V2, faces: readonly SpotFace[], aspect: number): Region {
  return regionIn(regionIndex(faces, aspect), o);
}

/**
 * Spot radius (fraction of the O short edge): k × the reference face width — the face whose oval holds the tap, else the
 * nearest face whose box grown by 50 % holds it, else the median face width, else 0.35 × the short edge — clamped to
 * [3 working px, 0.04].
 */
export function spotRadius(o: V2, size: SpotSize, faces: readonly SpotFace[], work: { width: number; height: number }): number {
  const aspect = work.width / work.height;
  const short = Math.min(work.width, work.height);
  const fw = (f: Face) => (dist(isoOf(f, 0, aspect), isoOf(f, 32, aspect)) * work.width) / short;
  const q: V2 = [o[0], o[1] / aspect];
  let ref: number | null = null;
  const holder = faces.find((f) => inPolygon(q, ovalIso(f.face, aspect)));
  if (holder) ref = fw(holder.face);
  else {
    let best = Infinity;
    for (const f of faces) {
      const xs: number[] = [];
      const ys: number[] = [];
      for (let i = 0; i < f.face.oval.length; i += 2) {
        xs.push(f.face.oval[i]);
        ys.push(f.face.oval[i + 1]);
      }
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const hw = 0.75 * (Math.max(...xs) - Math.min(...xs));
      const hh = 0.75 * (Math.max(...ys) - Math.min(...ys));
      if (Math.abs(o[0] - cx) > hw || Math.abs(o[1] - cy) > hh) continue;
      const d = Math.hypot(o[0] - cx, (o[1] - cy) / aspect);
      if (d < best) {
        best = d;
        ref = fw(f.face);
      }
    }
    if (ref === null && faces.length) {
      const ws = faces.map((f) => fw(f.face)).sort((a, b) => a - b);
      ref = ws.length % 2 ? ws[(ws.length - 1) / 2] : (ws[ws.length / 2 - 1] + ws[ws.length / 2]) / 2;
    }
  }
  return Math.min(0.04, Math.max(3 / short, SPOT_K[size] * (ref ?? 0.35)));
}

export interface OwnerCtx {
  faces: readonly { person: PersonId; face: Face }[];
  bodies: readonly { person: PersonId; mask: PersonMask }[];
  aspect: number;
}

/** the face and body-mask owners of the detection cache (persons link faces and bodies by id) */
export function ownerCtxOf(detect: Pick<DetectionCache, 'persons' | 'bodies'> | null, faces: readonly SpotFace[], aspect: number): OwnerCtx {
  const persons = detect?.persons ?? [];
  const byFace = new Map(persons.flatMap((p) => (p.face ? [[p.face, p.id] as const] : [])));
  const byBody = new Map(persons.flatMap((p) => (p.body ? [[p.body, p.id] as const] : [])));
  return {
    faces: faces.flatMap((f) => {
      const person = byFace.get(f.id);
      return person === undefined ? [] : [{ person, face: f.face }];
    }),
    bodies: (detect?.bodies ?? []).flatMap((b) => {
      const person = byBody.get(b.id);
      return b.mask && person !== undefined ? [{ person, mask: b.mask }] : [];
    }),
    aspect,
  };
}

/**
 * The person a spot belongs to (S §3.3): the face region first, else the body mask rule of the photo hit test (C §2.2,
 * bodyHit.ts maskHit: the nearest sample, the highest value ≥ 128 (0.5), equal values → the smaller normalized area),
 * so a spot's owner is the person a tap at the same point selects; else null.
 */
export function ownerAt(o: V2, ctx: OwnerCtx): PersonId | null {
  const reg = regionAt(o, ctx.faces.map((f) => ({ id: f.person, face: f.face })), ctx.aspect);
  if (reg.kind !== 'other' && reg.face) return reg.face;
  return maskHit(o, ctx.bodies);
}

/** RGBA8 pixels of the working bitmap around a tap (patch.ts); `rect` is the O rectangle they cover */
export interface Patch {
  data: ArrayLike<number>;
  w: number;
  h: number;
  rect: Rect;
  /** patch px per O short edge */
  pxPerShort: number;
}
export interface PlanCtx {
  faces: readonly SpotFace[];
  aspect: number;
  existing: readonly Spot[];
}
export type PlanResult = Spot | { refused: 'eye' | 'mouth' | 'cap' };

/** integer offsets within the annulus r0 ≤ |o| ≤ r1 (a disc for r0 = 0) */
function offsets(r0: number, r1: number): [number, number][] {
  const out: [number, number][] = [];
  const n = Math.ceil(r1);
  for (let y = -n; y <= n; y++) for (let x = -n; x <= n; x++) if (x * x + y * y >= r0 * r0 && x * x + y * y <= r1 * r1) out.push([x, y]);
  return out;
}

/** a patch as Y, Cr and RGB planes (0..1), indexed with edge clamping */
class PatchView {
  readonly Y: Float32Array;
  readonly Cr: Float32Array;
  readonly rgb: Float32Array;
  constructor(readonly p: Patch) {
    const n = p.w * p.h;
    this.Y = new Float32Array(n);
    this.Cr = new Float32Array(n);
    this.rgb = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = p.data[i * 4] / 255;
      const g = p.data[i * 4 + 1] / 255;
      const b = p.data[i * 4 + 2] / 255;
      this.rgb[i * 3] = r;
      this.rgb[i * 3 + 1] = g;
      this.rgb[i * 3 + 2] = b;
      this.Y[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b; // Rec. 709 luma
      this.Cr[i] = 0.5 + 0.5 * r - 0.418688 * g - 0.081312 * b; // JPEG full-range Cr
    }
  }
  idx(x: number, y: number): number {
    return Math.min(this.p.h - 1, Math.max(0, y)) * this.p.w + Math.min(this.p.w - 1, Math.max(0, x));
  }
  /** O → patch px (continuous; pixel centres at i + 0.5) */
  toPatch(o: V2): V2 {
    return [((o[0] - this.p.rect.x) / this.p.rect.w) * this.p.w, ((o[1] - this.p.rect.y) / this.p.rect.h) * this.p.h];
  }
  toO(q: V2): V2 {
    return [this.p.rect.x + (q[0] / this.p.w) * this.p.rect.w, this.p.rect.y + (q[1] / this.p.h) * this.p.rect.h];
  }
  mean(plane: Float32Array, cx: number, cy: number, offs: readonly [number, number][]): number {
    let s = 0;
    for (const [dx, dy] of offs) s += plane[this.idx(cx + dx, cy + dy)];
    return s / offs.length;
  }
  /** mean(Y) and mean(Cr) over the offsets in one pass (the snap's hot loop); each sum runs in mean()'s order */
  meanYCr(cx: number, cy: number, offs: readonly [number, number][], out: [number, number]): [number, number] {
    let y = 0;
    let c = 0;
    for (const [dx, dy] of offs) {
      const i = this.idx(cx + dx, cy + dy);
      y += this.Y[i];
      c += this.Cr[i];
    }
    out[0] = y / offs.length;
    out[1] = c / offs.length;
    return out;
  }
  sd(cx: number, cy: number, offs: readonly [number, number][]): number {
    const m = this.mean(this.Y, cx, cy, offs);
    let s = 0;
    for (const [dx, dy] of offs) s += (this.Y[this.idx(cx + dx, cy + dy)] - m) ** 2;
    return Math.sqrt(s / offs.length);
  }
  /** mean |Y − box3(Y)| over the offsets */
  hf(cx: number, cy: number, offs: readonly [number, number][]): number {
    let s = 0;
    for (const [dx, dy] of offs) {
      const x = cx + dx;
      const y = cy + dy;
      let b = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) b += this.Y[this.idx(x + i, y + j)];
      s += Math.abs(this.Y[this.idx(x, y)] - b / 9);
    }
    return s / offs.length;
  }
  /** bilinear RGB at continuous patch px */
  rgbAt(x: number, y: number, out: number[]): number[] {
    const fx = x - 0.5;
    const fy = y - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const ax = fx - x0;
    const ay = fy - y0;
    const i00 = this.idx(x0, y0) * 3;
    const i10 = this.idx(x0 + 1, y0) * 3;
    const i01 = this.idx(x0, y0 + 1) * 3;
    const i11 = this.idx(x0 + 1, y0 + 1) * 3;
    for (let c = 0; c < 3; c++) out[c] = (this.rgb[i00 + c] * (1 - ax) + this.rgb[i10 + c] * ax) * (1 - ay) + (this.rgb[i01 + c] * (1 - ax) + this.rgb[i11 + c] * ax) * ay;
    return out;
  }
}

const l1 = (a: ArrayLike<number>) => (Math.abs(a[0]) + Math.abs(a[1]) + Math.abs(a[2])) / 3;

/**
 * The spot for a tap (S §3.5, deterministic): snap the centre to the blemish within 0.8 r, choose the donor among 16
 * offsets ({2.4 r, 3.2 r} × 8 directions) by the ring-mismatch cost, or fill mode (dx = dy = 0) when none is valid.
 * `owner` is null (the editor sets it with ownerAt). Units: x, y normalized O; r, dx, dy fractions of the O short edge.
 */
export function planSpot(patch: Patch, tap: V2, r: number, ctx: PlanCtx): PlanResult {
  if (ctx.existing.length >= SPOT_CAP) return { refused: 'cap' };
  // ~146 region queries per tap (the tap, the centre, 16 donors × 9 points): the polygons are built once
  const ix = regionIndex(ctx.faces, ctx.aspect);
  const at = regionIn(ix, tap);
  if (at.kind === 'eye' || at.kind === 'mouth') return { refused: at.kind };
  const P = new PatchView(patch);
  const rp = r * patch.pxPerShort;
  const t = P.toPatch(tap);
  const core = offsets(0, 0.5 * rp);
  const ann = offsets(1.3 * rp, 1.6 * rp);
  const disc = offsets(0, rp);

  // snap: s(x) = max(0, Ȳ_ring − Ȳ_core) + 0.6·max(0, C̄r_core − C̄r_ring) over pixel centres within 0.8 r of the tap
  let best = -1;
  let bestD = Infinity;
  let snapped: V2 = t;
  const reach = 0.8 * rp;
  const mc: [number, number] = [0, 0];
  const mr: [number, number] = [0, 0];
  for (let y = Math.floor(t[1] - reach); y <= Math.ceil(t[1] + reach); y++)
    for (let x = Math.floor(t[0] - reach); x <= Math.ceil(t[0] + reach); x++) {
      const d = Math.hypot(x + 0.5 - t[0], y + 0.5 - t[1]);
      if (d > reach || x < 0 || y < 0 || x >= patch.w || y >= patch.h) continue;
      const [yCore, crCore] = P.meanYCr(x, y, core, mc);
      const [yRing, crRing] = P.meanYCr(x, y, ann, mr);
      const s = Math.max(0, yRing - yCore) + 0.6 * Math.max(0, crCore - crRing);
      if (s > best + 1e-12 || (Math.abs(s - best) <= 1e-12 && d < bestD)) {
        best = s;
        bestD = d;
        snapped = [x + 0.5, y + 0.5];
      }
    }
  const moved = best >= 0.015;
  let c: V2 = moved ? snapped : t;
  let cO: V2 = moved ? P.toO(snapped) : tap;
  let reg = regionIn(ix, cO);
  if (reg.kind === 'eye' || reg.kind === 'mouth') {
    // never snap into an eye or the mouth: keep the tap
    c = t;
    cO = tap;
    reg = at;
  }

  // donor
  const N = 32;
  const T: number[][] = [];
  for (let k = 0; k < N; k++) {
    const a = (2 * Math.PI * k) / N;
    T.push(P.rgbAt(c[0] + 1.3 * rp * Math.cos(a), c[1] + 1.3 * rp * Math.sin(a), [0, 0, 0]));
  }
  const ci = [Math.floor(c[0]), Math.floor(c[1])] as const;
  const hfSpot = P.hf(ci[0], ci[1], ann);
  const others = ctx.existing.map((s) => ({ c: P.toPatch([s.x, s.y]), r: s.r * patch.pxPerShort }));
  let bestE = Infinity;
  let donor: V2 | null = null;
  const D = [0, 0, 0];
  // distances first, then the angle index: a strict < keeps the earlier candidate on a tie
  for (const k of [2.4, 3.2])
    for (let j = 0; j < 8; j++) {
      const a = (j * Math.PI) / 4;
      const off: V2 = [k * rp * Math.cos(a), k * rp * Math.sin(a)];
      const dc: V2 = [c[0] + off[0], c[1] + off[1]];
      if (dc[0] - 1.4 * rp < 0 || dc[1] - 1.4 * rp < 0 || dc[0] + 1.4 * rp > patch.w || dc[1] + 1.4 * rp > patch.h) continue;
      const dreg = regionIn(ix, P.toO(dc));
      if (dreg.kind !== reg.kind || dreg.face !== reg.face) continue;
      let rimOk = true;
      for (let m = 0; m < 8 && rimOk; m++) {
        const b = (m * Math.PI) / 4;
        const kind = regionIn(ix, P.toO([dc[0] + 1.1 * rp * Math.cos(b), dc[1] + 1.1 * rp * Math.sin(b)])).kind;
        rimOk = kind !== 'eye' && kind !== 'mouth';
      }
      if (!rimOk) continue;
      if (others.some((o) => Math.hypot(dc[0] - o.c[0], dc[1] - o.c[1]) < 1.1 * (rp + o.r))) continue;
      const deltas: number[][] = [];
      const mean = [0, 0, 0];
      for (let n = 0; n < N; n++) {
        const b = (2 * Math.PI * n) / N;
        P.rgbAt(dc[0] + 1.3 * rp * Math.cos(b), dc[1] + 1.3 * rp * Math.sin(b), D);
        const dd = [T[n][0] - D[0], T[n][1] - D[1], T[n][2] - D[2]];
        deltas.push(dd);
        for (let q = 0; q < 3; q++) mean[q] += dd[q] / N;
      }
      let mismatch = 0;
      for (const dd of deltas) mismatch += l1([dd[0] - mean[0], dd[1] - mean[1], dd[2] - mean[2]]) / N;
      const di = [Math.floor(dc[0]), Math.floor(dc[1])] as const;
      const E =
        mismatch +
        0.25 * l1(mean) +
        2 * Math.max(0, P.sd(di[0], di[1], disc) - 1.5 * P.sd(di[0], di[1], ann)) +
        0.5 * Math.abs(P.hf(di[0], di[1], disc) - hfSpot);
      if (E < bestE) {
        bestE = E;
        donor = off;
      }
    }
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  return {
    x: clamp01(cO[0]),
    y: clamp01(cO[1]),
    r,
    dx: donor ? donor[0] / patch.pxPerShort : 0,
    dy: donor ? donor[1] / patch.pxPerShort : 0,
    owner: null,
  };
}
