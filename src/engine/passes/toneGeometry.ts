// 膚質 region geometry (skin-cleanup spec §4.2): O-space triangle lists (x, y, value) for the ¼-res targets R and Q,
// built from one adapted face, plus the gates folded into each region's strength. Pure, no GL; toneMask.ts draws them.
// Every distance is iso (fractions of the image width on both axes, as mask.ts:70): the iso point of a uv is
// (x, y / aspect). pts111 indices follow src/tracking/adapter111.ts; image-left = GPUPixel left. Original work.
import type { Face, ParamId } from '../../types';
import { buildMaskGeometry, MASK_MAX_FLOATS } from './mask';

export type V2 = [number, number];
/** image-left / image-right half of the face */
export type Side = 'L' | 'R';
export const SIDES: readonly Side[] = ['L', 'R'];

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

const add = (a: V2, b: V2): V2 => [a[0] + b[0], a[1] + b[1]];
const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const mul = (a: V2, k: number): V2 => [a[0] * k, a[1] * k];
const dot = (a: V2, b: V2): number => a[0] * b[0] + a[1] * b[1];
export const dist = (a: V2, b: V2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
function unit(a: V2): V2 {
  const l = Math.hypot(a[0], a[1]);
  return l > 1e-12 ? [a[0] / l, a[1] / l] : [0, 0];
}
export function centroid(ps: readonly V2[]): V2 {
  let x = 0;
  let y = 0;
  for (const p of ps) {
    x += p[0];
    y += p[1];
  }
  return ps.length ? [x / ps.length, y / ps.length] : [0, 0];
}

export function isoPt(face: Face, i: number, aspect: number): V2 {
  return [face.pts111[i * 2], face.pts111[i * 2 + 1] / aspect];
}

export interface FaceFrame {
  /** iso face width |P(0) − P(32)| (mask.ts:94) */
  fw: number;
  /** unit vector between the eye centres, P(74) → P(77) */
  xhat: V2;
  /** x̂ turned +90°, negated when needed so it points to the chin (ext[4], the menton) */
  yhat: V2;
  /** |P(52) − P(55)|, |P(58) − P(61)| */
  eyeW: Record<Side, number>;
  /** |P(84) − P(90)| */
  mouthW: number;
}

export function faceFrame(face: Face, aspect: number): FaceFrame {
  const P = (i: number) => isoPt(face, i, aspect);
  const xhat = unit(sub(P(77), P(74)));
  let yhat: V2 = [-xhat[1], xhat[0]];
  const menton: V2 = [face.ext[8], face.ext[9] / aspect];
  if (dot(yhat, sub(menton, P(46))) < 0) yhat = [-yhat[0], -yhat[1]];
  return { fw: dist(P(0), P(32)), xhat, yhat, eyeW: { L: dist(P(52), P(55)), R: dist(P(58), P(61)) }, mouthW: dist(P(84), P(90)) };
}

/** eye aspect ratio: |P72 − P73| / eyeW_L (image-right: P75, P76, eyeW_R) */
export function earOf(face: Face, side: Side, aspect: number): number {
  const w = faceFrame(face, aspect).eyeW[side];
  const [a, b] = side === 'L' ? [72, 73] : [75, 76];
  return w > 1e-12 ? dist(isoPt(face, a, aspect), isoPt(face, b, aspect)) / w : 0;
}

/** 亮眼's per-eye gate (step 5's blink gate reuses it, C §4.4) */
export function eyeOpen(face: Face, side: Side, aspect: number): number {
  return smoothstep(0.12, 0.18, earOf(face, side, aspect));
}

/** |P98 − P102| / mouthW */
export function mouthOpen(face: Face, aspect: number): number {
  const w = faceFrame(face, aspect).mouthW;
  return w > 1e-12 ? dist(isoPt(face, 98, aspect), isoPt(face, 102, aspect)) / w : 0;
}

/** 白牙's gate: smoothstep(0.01, 0.03, mouthOpen) */
export function teethGate(face: Face, aspect: number): number {
  return smoothstep(0.01, 0.03, mouthOpen(face, aspect));
}

/** the side whose eye is nearer to the nose tip: image-right when yaw > 0 (adapter111.ts:92-103) */
export function farSide(face: Face): Side | null {
  return face.yaw > 0 ? 'R' : face.yaw < 0 ? 'L' : null;
}

/** far-side regions × (1 − smoothstep(0.25, 0.50, |yaw|)); the near side is never faded */
export function sideFade(face: Face, side: Side): number {
  return farSide(face) === side ? 1 - smoothstep(0.25, 0.5, Math.abs(face.yaw)) : 1;
}

/** `n` points along the polyline, equally spaced by arc length, endpoints included */
export function resampleChain(pts: readonly V2[], n: number): V2[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i], pts[i - 1]));
  const total = cum[cum.length - 1];
  const out: V2[] = [];
  let seg = 0;
  for (let k = 0; k < n; k++) {
    const t = n > 1 ? (total * k) / (n - 1) : 0;
    while (seg < pts.length - 2 && cum[seg + 1] < t) seg++;
    const l = cum[seg + 1] - cum[seg];
    const f = l > 0 ? Math.min(1, Math.max(0, (t - cum[seg]) / l)) : 0;
    out.push(add(pts[seg], mul(sub(pts[seg + 1], pts[seg]), f)));
  }
  return out;
}

/** a triangle list collected in iso space and emitted as O-normalized (x, y, value) triplets */
export class Tris {
  private readonly v: number[] = [];
  tri(a: V2, av: number, b: V2, bv: number, c: V2, cv: number): void {
    this.v.push(a[0], a[1], av, b[0], b[1], bv, c[0], c[1], cv);
  }
  /** a, b, c, d in order around the quad */
  quad(a: V2, av: number, b: V2, bv: number, c: V2, cv: number, d: V2, dv: number): void {
    this.tri(a, av, b, bv, c, cv);
    this.tri(a, av, c, cv, d, dv);
  }
  uv(aspect: number): Float32Array {
    const out = new Float32Array(this.v);
    for (let i = 1; i < out.length; i += 3) out[i] *= aspect;
    return out;
  }
}

const LOWER_LID: Record<Side, readonly number[]> = { L: [52, 57, 73, 56, 55], R: [61, 62, 76, 63, 58] };

/**
 * 黑眼圈 crescent (R.R): the lower-lid chain resampled to 7 points (t = 0…1, τ = sin πt) and three rows along ŷ at
 * 0.06·eyeW (value 0), (0.06 + 0.12τ)·eyeW (value τ) and (0.06 + 0.40τ)·eyeW (value 0): it tapers to nothing at the eye
 * corners and leaves the lashes alone.
 */
export function crescentGeometry(face: Face, side: Side, aspect: number): Float32Array {
  const f = faceFrame(face, aspect);
  const chain = resampleChain(LOWER_LID[side].map((i) => isoPt(face, i, aspect)), 7);
  const w = f.eyeW[side];
  const r0: V2[] = [];
  const r1: V2[] = [];
  const r2: V2[] = [];
  const val: number[] = [];
  for (let i = 0; i < 7; i++) {
    const tau = Math.sin((Math.PI * i) / 6);
    r0.push(add(chain[i], mul(f.yhat, 0.06 * w)));
    r1.push(add(chain[i], mul(f.yhat, (0.06 + 0.12 * tau) * w)));
    r2.push(add(chain[i], mul(f.yhat, (0.06 + 0.4 * tau) * w)));
    val.push(tau);
  }
  const t = new Tris();
  for (let i = 0; i < 6; i++) {
    t.quad(r0[i], 0, r0[i + 1], 0, r1[i + 1], val[i + 1], r1[i], val[i]);
    t.quad(r1[i], val[i], r1[i + 1], val[i + 1], r2[i + 1], 0, r2[i], 0);
  }
  return t.uv(aspect);
}

/**
 * 法令紋 band (R.G), per side with o = −x̂ (image-left) or +x̂: S = P(82|83) + 0.04fw·o − 0.01fw·ŷ,
 * E = P(84|90) + 0.06fw·o + 0.05fw·ŷ, control C = (S + E)/2 + 0.035fw·o; a quadratic Bézier with 9 samples, half-width
 * h(t) = 0.035fw·(0.6 + 0.4 sin πt), rows −h (0), centre (1 × smoothstep over the first and last 15 %), +h (0).
 */
export function nasolabialGeometry(face: Face, side: Side, aspect: number): Float32Array {
  const f = faceFrame(face, aspect);
  const P = (i: number) => isoPt(face, i, aspect);
  const o: V2 = side === 'L' ? mul(f.xhat, -1) : f.xhat;
  const [ia, ib] = side === 'L' ? [82, 84] : [83, 90];
  const S = add(add(P(ia), mul(o, 0.04 * f.fw)), mul(f.yhat, -0.01 * f.fw));
  const E = add(add(P(ib), mul(o, 0.06 * f.fw)), mul(f.yhat, 0.05 * f.fw));
  const C = add(mul(add(S, E), 0.5), mul(o, 0.035 * f.fw));
  const lo: V2[] = [];
  const mid: V2[] = [];
  const hi: V2[] = [];
  const val: number[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const u = 1 - t;
    const p = add(add(mul(S, u * u), mul(C, 2 * u * t)), mul(E, t * t));
    const tan = add(mul(sub(C, S), 2 * u), mul(sub(E, C), 2 * t));
    // turned the opposite way on the image-right side, so the +h row is o's row on both sides and a mirrored face
    // gives the mirrored triangle list (the same quad diagonals), not just the mirrored outline
    const n = unit(side === 'L' ? [-tan[1], tan[0]] : [tan[1], -tan[0]]);
    const h = 0.035 * f.fw * (0.6 + 0.4 * Math.sin(Math.PI * t));
    lo.push(add(p, mul(n, -h)));
    mid.push(p);
    hi.push(add(p, mul(n, h)));
    val.push(smoothstep(0, 0.15, t) * (1 - smoothstep(0.85, 1, t)));
  }
  const tr = new Tris();
  for (let i = 0; i < 8; i++) {
    tr.quad(lo[i], 0, lo[i + 1], 0, mid[i + 1], val[i + 1], mid[i], val[i]);
    tr.quad(mid[i], val[i], mid[i + 1], val[i + 1], hi[i + 1], 0, hi[i], 0);
  }
  return tr.uv(aspect);
}

/** 8-bit zero point of the signed targets Q.B and Δ8: 128/255 is stored exactly, so neutral decodes to exactly 0 */
export const TONE_ZERO = 128 / 255;

/** O-normalized rectangle a target covers: x, y, w, h (the preview covers the whole O) */
export type Win = readonly [number, number, number, number];
export const IDENTITY_WIN: Win = [0, 0, 1, 1];
export type Rgba = readonly [number, number, number, number];
export type ChannelMask = readonly [boolean, boolean, boolean, boolean];
export const R_CLEAR: Rgba = [0, 0, 0, 0];
export const Q_CLEAR: Rgba = [0, 0, TONE_ZERO, 0];

export interface ToneValues {
  even: number;
  /** 0..1, 0.5 neutral (−50 冷 … +50 暖) */
  warmth: number;
  darkCircle: number;
  nasolabial: number;
  teeth: number;
  eyeBright: number;
}
export const NEUTRAL_TONE: ToneValues = { even: 0, warmth: 0.5, darkCircle: 0, nasolabial: 0, teeth: 0, eyeBright: 0 };

const v01 = (v: number | undefined, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);
export function toneValuesOf(v: Readonly<Partial<Record<ParamId, number>>>): ToneValues {
  return {
    even: v01(v['tone.even'], 0),
    warmth: v01(v['tone.warmth'], 0.5),
    darkCircle: v01(v['tone.darkCircle'], 0),
    nasolabial: v01(v['tone.nasolabial'], 0),
    teeth: v01(v['tone.teeth'], 0),
    eyeBright: v01(v['tone.eyeBright'], 0),
  };
}
/** the items the tone field P0c serves (S §4.1: 勻膚, 膚色, 黑眼圈 or 法令紋) */
export function fieldActive(t: ToneValues): boolean {
  return t.even > 0 || t.warmth !== 0.5 || t.darkCircle > 0 || t.nasolabial > 0;
}
export function toneActive(t: ToneValues): boolean {
  return fieldActive(t) || t.teeth > 0 || t.eyeBright > 0;
}

/** step 1's influence cap of one face (face-table texel 73): centre in UV, radius iso; r < 0 = no cap */
export interface ToneCap {
  c: V2;
  r: number;
}
export interface ToneFaceInput {
  face: Face;
  values: ToneValues;
  /** RenderFace.weight (1 in the editor) */
  weight: number;
  cap: ToneCap | null;
}
/** one draw into R or Q: writes off + str · smoothstep(0, 1, value) through `mask` with blend equation `blend` */
export interface ToneDraw {
  /** draws run in ascending phase, then in list order */
  phase: 0 | 1 | 2 | 3;
  blend: 'max' | 'min';
  mask: ChannelMask;
  off: Rgba;
  str: Rgba;
  /** x, y (O-normalized uv), value — a triangle list */
  verts: Float32Array;
}

/** `p` moved by `d` along the ray from `c` (d < 0: toward c) */
const away = (p: V2, c: V2, d: number): V2 => add(p, mul(unit(sub(p, c)), d));

// Both rings run corner, upper ×3, corner, lower ×3: [c0, U1, U2, U3, c4, L3, L2, L1], so point i (1…3, 5…7) faces its
// rung partner 8 − i across the opening.
const INNER_LIP = [96, 97, 98, 99, 100, 101, 102, 103];
const EYE_RING: Record<Side, readonly number[]> = { L: [52, 53, 72, 54, 55, 56, 73, 57], R: [58, 59, 75, 60, 61, 62, 76, 63] };

/**
 * The centre ring point i moves toward (inset) or away from (outset): the midpoint of its rung, and for a corner the
 * midpoint of the nearest rung. A thin, curved opening (an almost closed mouth, a squint) is not star-shaped about its
 * centroid — the recorded face's inner lip already is not — so moving every point toward one centroid folds the ring.
 */
function rungCentre(ring: readonly V2[], i: number): V2 {
  const k = i === 0 ? 1 : i === 4 ? 3 : i;
  return mul(add(ring[k], ring[8 - k]), 0.5);
}

/** a, b, c, d in order around the quad, split along the diagonal that keeps both halves one way round (the shorter one when both do) */
function quadSplit(t: Tris, a: V2, av: number, b: V2, bv: number, c: V2, cv: number, d: V2, dv: number): void {
  const s = (p: V2, q: V2, r: V2) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const okAC = s(a, b, c) !== 0 && s(a, b, c) === s(a, c, d);
  const okBD = s(a, b, d) !== 0 && s(a, b, d) === s(b, c, d);
  if (okBD && (!okAC || dist(b, d) < dist(a, c))) {
    t.tri(a, av, b, bv, d, dv);
    t.tri(b, bv, c, cv, d, dv);
  } else t.quad(a, av, b, bv, c, cv, d, dv);
}

/** the polygon of an 8-point ring at value `v`, triangulated as a ladder of its rungs (exact for any simple opening) */
function ladder(t: Tris, p: readonly V2[], v: number): void {
  t.tri(p[0], v, p[1], v, p[7], v);
  quadSplit(t, p[1], v, p[2], v, p[6], v, p[7], v);
  quadSplit(t, p[2], v, p[3], v, p[5], v, p[6], v);
  t.tri(p[3], v, p[4], v, p[5], v);
}

/** 白牙 (R.B): 1 on the inner-lip polygon, falling to 0 over an outward ring of 0.04·mouthW */
export function mouthGeometry(face: Face, aspect: number): Float32Array {
  const f = faceFrame(face, aspect);
  const poly = INNER_LIP.map((i) => isoPt(face, i, aspect));
  const outer = poly.map((p, i) => away(p, rungCentre(poly, i), 0.04 * f.mouthW));
  const t = new Tris();
  ladder(t, poly, 1);
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    quadSplit(t, outer[i], 0, outer[j], 0, poly[j], 1, poly[i], 1);
  }
  return t.uv(aspect);
}

/**
 * 亮眼 (R.A): each eye-ring point moved toward its rung centre c — value 0 at an inset of min(0.04·eyeW, 0.25|c − p|),
 * value 1 at min(0.12·eyeW, 0.5|c − p|), 1 inside. The capped insets never cross the opening's midline (S §4.2), and
 * the lid skin stays out.
 */
export function eyeGeometry(face: Face, side: Side, aspect: number): Float32Array {
  const w = faceFrame(face, aspect).eyeW[side];
  const ring = EYE_RING[side].map((i) => isoPt(face, i, aspect));
  const inset = (k: number, cap: number) =>
    ring.map((p, i) => {
      const c = rungCentre(ring, i);
      return away(p, c, -Math.min(k * w, cap * dist(c, p)));
    });
  const a = inset(0.04, 0.25);
  const b = inset(0.12, 0.5);
  const t = new Tris();
  ladder(t, b, 1);
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    quadSplit(t, a[i], 0, a[j], 0, b[j], 1, b[i], 1);
  }
  return t.uv(aspect);
}

/**
 * Width w_T of 膚色's outer ring: 0.30 fw without a cap; otherwise clamp(cap − r_oval, 0.08 fw, 0.30 fw), r_oval being
 * the largest iso distance from the cap centre to an oval point, so the ring stops about halfway to the next face.
 */
export function warmRingWidth(face: Face, aspect: number, cap: ToneCap | null): number {
  const fw = faceFrame(face, aspect).fw;
  if (!cap || !(cap.r >= 0)) return 0.3 * fw;
  const c: V2 = [cap.c[0], cap.c[1] / aspect];
  let rOval = 0;
  for (let i = 0; i < face.oval.length; i += 2) rOval = Math.max(rOval, dist(c, [face.oval[i], face.oval[i + 1] / aspect]));
  return Math.min(0.3 * fw, Math.max(0.08 * fw, cap.r - rOval));
}

const ALL: ChannelMask = [true, true, true, true];
const RG: ChannelMask = [true, true, false, false];
const BLUE: ChannelMask = [false, false, true, false];
const NONE4: Rgba = [0, 0, 0, 0];

/** R: R 黑眼圈 · G 法令紋 · B 白牙 · A 亮眼, every region MAX (overlaps keep the strongest face); zero strengths are skipped */
export function toneDrawsR(faces: readonly ToneFaceInput[], aspect: number): ToneDraw[] {
  const out: ToneDraw[] = [];
  const put = (str: Rgba, geometry: () => Float32Array) => {
    if (str[0] > 0 || str[1] > 0 || str[2] > 0 || str[3] > 0) out.push({ phase: 0, blend: 'max', mask: ALL, off: NONE4, str, verts: geometry() });
  };
  for (const { face, values: v, weight } of faces) {
    const w = weight > 0 ? Math.min(1, weight) : 0;
    if (w === 0) continue;
    for (const side of SIDES) {
      const fade = sideFade(face, side);
      put([w * v.darkCircle * fade, 0, 0, 0], () => crescentGeometry(face, side, aspect));
      put([0, w * v.nasolabial * fade, 0, 0], () => nasolabialGeometry(face, side, aspect));
      put([0, 0, 0, w * v.eyeBright * eyeOpen(face, side, aspect) * fade], () => eyeGeometry(face, side, aspect));
    }
    put([0, 0, w * v.teeth * teethGate(face, aspect), 0], () => mouthGeometry(face, aspect));
  }
  return out;
}

/**
 * Q: R 勻膚 strength · G skin coverage · B 膚色 around TONE_ZERO.
 * Skin, channels R and G, in mask.ts's order: every face's 8 % fw ring MAX (phase 0); every oval fan overwritten with
 * its own strength, as a MIN (phase 1) and then a MAX (phase 2) at that constant, so a neighbour's ring never lifts a
 * neutral face's oval (C §4.1: its skin mask writes 0) and where two fans overlap the stronger face wins; eye and mouth
 * holes MIN (phase 3). For one face this writes exactly what ring + fan MAX would.
 * 膚色, channel B: oval + w_T ring and the same holes; a warm face draws MAX then MIN holes, a cool face MIN then MAX
 * holes, so a hole pulls toward neutral from either side (phases 2, 3; they share those phases with the skin draws,
 * whose channel masks do not meet theirs).
 */
export function toneDrawsQ(faces: readonly ToneFaceInput[], aspect: number): ToneDraw[] {
  const out: ToneDraw[] = [];
  const buf = new Float32Array(MASK_MAX_FLOATS);
  const parts = (face: Face, ringIso?: number) => {
    const [count, base, fanEnd] = buildMaskGeometry(face, aspect, buf, ringIso);
    return {
      ring: buf.slice(fanEnd * 3, base * 3),
      fans: buf.slice(0, fanEnd * 3),
      base: buf.slice(0, base * 3),
      holes: buf.slice(base * 3, count * 3),
    };
  };
  for (const { face, values: v, weight, cap } of faces) {
    const w = weight > 0 ? Math.min(1, weight) : 0;
    if (w === 0) continue;
    const skin = parts(face);
    const str: Rgba = [w * v.even, 1, 0, 0];
    out.push({ phase: 0, blend: 'max', mask: RG, off: NONE4, str, verts: skin.ring });
    out.push({ phase: 1, blend: 'min', mask: RG, off: NONE4, str, verts: skin.fans });
    out.push({ phase: 2, blend: 'max', mask: RG, off: NONE4, str, verts: skin.fans });
    out.push({ phase: 3, blend: 'min', mask: RG, off: NONE4, str, verts: skin.holes });
    const s = 2 * (v.warmth - 0.5) * w;
    if (s !== 0) {
      const g = parts(face, warmRingWidth(face, aspect, cap));
      const off: Rgba = [0, 0, TONE_ZERO, 0];
      const ws: Rgba = [0, 0, 0.5 * s, 0];
      out.push({ phase: 2, blend: s > 0 ? 'max' : 'min', mask: BLUE, off, str: ws, verts: g.base });
      out.push({ phase: 3, blend: s > 0 ? 'min' : 'max', mask: BLUE, off, str: ws, verts: g.holes });
    }
  }
  return out;
}
