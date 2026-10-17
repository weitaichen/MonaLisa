// Geometry of the v0.4 crop / rotate / flip (contract §3.5, step-3 spec §3.1–3.3). Spaces: O (the EXIF-oriented original,
// normalized [0,1]², y down), E (O after flipH, then `quarter` clockwise quarter turns: an exact permutation), V (the crop
// of the E plane straightened by θ, normalized to the crop) and U (O turned by whole quarters only, never mirrored, so
// U-up = E-up and E rows = U rows). Every map is one 2 × 3 affine in normalized coordinates. Pure: no DOM, no GL.
import { MIN_CROP_FRAC, MIN_CROP_PX } from '../config/limits';
import type { Geometry, Rect, Size } from '../types';

export type Quarter = 0 | 1 | 2 | 3;
export type Vec2 = readonly [number, number];
/** x' = a·x + c·y + e, y' = b·x + d·y + f (DOMMatrix order) */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY_GEOMETRY: Geometry = { flipH: false, quarter: 0, straighten: 0, crop: { x: 0, y: 0, w: 1, h: 1 } };
/** uGeo at identity: exact, so P2's `uGeo * vec3(v, 1)` is bit-identical to `v` (parity) */
export const IDENTITY_MAT3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
const ID: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const FLIP: Affine = { a: -1, b: 0, c: 0, d: 1, e: 1, f: 0 };
const STEPS = 24;

export function isFullCrop(c: Rect): boolean {
  return c.x === 0 && c.y === 0 && c.w === 1 && c.h === 1;
}

export function isIdentity(g: Geometry): boolean {
  return !g.flipH && g.quarter === 0 && g.straighten === 0 && isFullCrop(g.crop);
}

/** m after n */
export function compose(m: Affine, n: Affine): Affine {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

export function invert(m: Affine): Affine {
  const det = m.a * m.d - m.b * m.c;
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  };
}

export function apply(m: Affine, p: Vec2): [number, number] {
  return [m.a * p[0] + m.c * p[1] + m.e, m.b * p[0] + m.d * p[1] + m.f];
}

/** the linear part only (brush deltas, step 6) */
export function applyVec(m: Affine, d: Vec2): [number, number] {
  return [m.a * d[0] + m.c * d[1], m.b * d[0] + m.d * d[1]];
}

/** q clockwise quarter turns of normalized coordinates: R1 (x, y) → (1 − y, x), R2 → (1 − x, 1 − y), R3 → (y, 1 − x) */
export function quarterAffine(q: Quarter): Affine {
  switch (q) {
    case 0:
      return ID;
    case 1:
      return { a: 0, b: 1, c: -1, d: 0, e: 1, f: 0 };
    case 2:
      return { a: -1, b: 0, c: 0, d: -1, e: 1, f: 1 };
    case 3:
      return { a: 0, b: -1, c: 1, d: 0, e: 0, f: 1 };
  }
}

export function eSize(g: Pick<Geometry, 'quarter'>, o: Size): Size {
  return g.quarter % 2 === 1 ? { width: o.height, height: o.width } : { width: o.width, height: o.height };
}

/** the U frame's quarter: E = U, or E = mirror_x(U) (C §3.5) */
export function upQuarter(g: Pick<Geometry, 'flipH' | 'quarter'>): Quarter {
  return (g.flipH ? (4 - g.quarter) % 4 : g.quarter) as Quarter;
}

export function oToE(g: Pick<Geometry, 'flipH' | 'quarter'>): Affine {
  const r = quarterAffine(g.quarter);
  return g.flipH ? compose(r, FLIP) : r;
}

export function eToO(g: Pick<Geometry, 'flipH' | 'quarter'>): Affine {
  return invert(oToE(g));
}

/** E-normalized → the straightened plane (rotation in pixels about the E centre, rigid when W ≠ H), normalized to E */
function plane(g: Geometry, oSize: Size): Affine {
  if (g.straighten === 0) return ID;
  const { width: W, height: H } = eSize(g, oSize);
  const t = (g.straighten * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const S: Affine = { a: W, b: 0, c: 0, d: H, e: -W / 2, f: -H / 2 };
  const R: Affine = { a: c, b: s, c: -s, d: c, e: 0, f: 0 };
  const N: Affine = { a: 1 / W, b: 0, c: 0, d: 1 / H, e: 0.5, f: 0.5 };
  return compose(N, compose(R, S));
}

function cropAffine(k: Rect): Affine {
  return isFullCrop(k) ? ID : { a: 1 / k.w, b: 0, c: 0, d: 1 / k.h, e: -k.x / k.w, f: -k.y / k.h };
}

export function eToV(g: Geometry, oSize: Size): Affine {
  return compose(cropAffine(g.crop), plane(g, oSize));
}

export function vToE(g: Geometry, oSize: Size): Affine {
  return invert(eToV(g, oSize));
}

export function oToV(g: Geometry, oSize: Size): Affine {
  return compose(eToV(g, oSize), oToE(g));
}

export function vToO(g: Geometry, oSize: Size): Affine {
  return invert(oToV(g, oSize));
}

/** column-major mat3 for `uGeo * vec3(v, 1.0)` */
export function glMat3(m: Affine): Float32Array {
  return new Float32Array([m.a, m.b, 0, m.c, m.d, 0, m.e, m.f, 1]);
}

/** V pixel size at the density of `oPx` (the O size in pixels) */
export function viewSize(g: Geometry, oPx: Size): Size {
  const e = eSize(g, oPx);
  return { width: Math.max(1, Math.round(g.crop.w * e.width)), height: Math.max(1, Math.round(g.crop.h * e.height)) };
}

/** θ = 0 only: the crop edges on whole pixels of `oPx`, so crop / quarter turn / flip are pixel copies (S §1.3) */
export function snapCrop(g: Geometry, oPx: Size): Geometry {
  if (g.straighten !== 0 || isFullCrop(g.crop)) return g;
  const { width: W, height: H } = eSize(g, oPx);
  const x0 = Math.round(g.crop.x * W);
  const y0 = Math.round(g.crop.y * H);
  const x1 = Math.max(x0 + 1, Math.round((g.crop.x + g.crop.w) * W));
  const y1 = Math.max(y0 + 1, Math.round((g.crop.y + g.crop.h) * H));
  return { ...g, crop: { x: x0 / W, y: y0 / H, w: (x1 - x0) / W, h: (y1 - y0) / H } };
}

/** the crop's aspect in E pixels */
export function cropAspectPx(g: Geometry, oSize: Size): number {
  const e = eSize(g, oSize);
  return (g.crop.w * e.width) / (g.crop.h * e.height);
}

/** 5 % of each E dimension and ≥ MIN_CROP_PX working px; 1 (the full frame) for an axis shorter than that */
export function minCrop(g: Pick<Geometry, 'quarter'>, oSize: Size): { w: number; h: number } {
  const e = eSize(g, oSize);
  return {
    w: Math.min(1, Math.max(MIN_CROP_FRAC, MIN_CROP_PX / e.width)),
    h: Math.min(1, Math.max(MIN_CROP_FRAC, MIN_CROP_PX / e.height)),
  };
}

/** every crop corner inside [0,1]² and inside the straightened image (both convex: the corners decide) */
export function cropFits(g: Geometry, oSize: Size, eps = 1e-9): boolean {
  const { width: W, height: H } = eSize(g, oSize);
  const t = (g.straighten * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const k = g.crop;
  const corners: Vec2[] = [
    [k.x, k.y],
    [k.x + k.w, k.y],
    [k.x, k.y + k.h],
    [k.x + k.w, k.y + k.h],
  ];
  for (const [px, py] of corners) {
    if (!(px >= -eps && py >= -eps && px <= 1 + eps && py <= 1 + eps)) return false;
    const x = (px - 0.5) * W;
    const y = (py - 0.5) * H;
    // back into E: Rot_{−θ}
    if (Math.abs(c * x + s * y) > W / 2 + eps * W || Math.abs(-s * x + c * y) > H / 2 + eps * H) return false;
  }
  return true;
}

export function cropValid(g: Geometry, oSize: Size, eps = 1e-9): boolean {
  const m = minCrop(g, oSize);
  return g.crop.w >= m.w - eps && g.crop.h >= m.h - eps && cropFits(g, oSize, eps);
}

/** the largest centred crop of pixel aspect `a` inside the image straightened by θ and inside the E frame (S §3.3) */
export function maxFit(theta: number, W: number, H: number, a: number): Rect {
  const t = (Math.abs(theta) * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const h = Math.min(W / (a * c + s), H / (a * s + c), H, W / a);
  // a full axis is exactly 1, so the untouched crop at θ = 0 is exactly the identity crop
  const unit = (v: number) => (v > 1 - 1e-9 ? 1 : v);
  const nw = unit((a * h) / W);
  const nh = unit(h / H);
  return { x: (1 - nw) / 2, y: (1 - nh) / 2, w: nw, h: nh };
}

const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;

export function isMaxFit(g: Geometry, oSize: Size): boolean {
  const e = eSize(g, oSize);
  const m = maxFit(g.straighten, e.width, e.height, cropAspectPx(g, oSize));
  const k = g.crop;
  return near(k.x, m.x, 1e-4) && near(k.y, m.y, 1e-4) && near(k.w, m.w, 1e-4) && near(k.h, m.h, 1e-4);
}

/**
 * Valid and idempotent (S §3.3): 1. the centre into the valid region (toward the E centre), 2. shrink about the centre,
 * 3. the minimum size, moving the centre toward the E centre until it fits. The pixel aspect is kept whenever a crop of
 * that aspect can meet the minimum size. One that cannot (a sliver from a corrupt record; a wide panorama straightened
 * far) becomes the max-fit of the E frame's own aspect or, when that is under the minimum too, the max-fit of the valid
 * aspect nearest the kept one. The valid region is convex and symmetric about the E centre, so a crop that fits can be
 * centred and still fit: whenever any valid crop exists the centred minimum box fits, the aspects whose max-fit is valid
 * are an interval around that box's aspect, and the result is valid. A photo too small for MIN_CROP_PX keeps its full
 * frame at θ = 0 (S §7); at θ ≠ 0 no crop is valid and it gets the frame aspect's max-fit, which fits but cannot be full.
 */
export function cropConstrain(g: Geometry, oSize: Size): Geometry {
  if (cropValid(g, oSize)) return g;
  const e = eSize(g, oSize);
  // before `fallback`, which the non-finite check below calls
  const m = minCrop(g, oSize);
  const k = g.crop;
  const aspect = Number.isFinite(k.w / k.h) && k.w > 0 && k.h > 0 ? (k.w * e.width) / (k.h * e.height) : e.width / e.height;
  const fit = (a: number): Geometry => ({ ...g, crop: maxFit(g.straighten, e.width, e.height, a) });
  const fallback = (): Geometry => {
    const kept = fit(aspect);
    if (cropValid(kept, oSize)) return kept;
    const frame = fit(e.width / e.height);
    if (cropValid(frame, oSize)) return frame;
    // the minimum box's aspect has a valid max-fit whenever any crop is valid; bisect (log aspect) toward the kept one
    let lo = Math.log((m.w * e.width) / (m.h * e.height));
    if (!cropValid(fit(Math.exp(lo)), oSize)) return frame;
    let hi = Math.log(aspect);
    for (let i = 0; i < STEPS; i++) {
      const t = (lo + hi) / 2;
      if (cropValid(fit(Math.exp(t)), oSize)) lo = t;
      else hi = t;
    }
    return fit(Math.exp(lo));
  };
  if (![k.x, k.y, k.w, k.h].every(Number.isFinite) || !(k.w > 0 && k.h > 0)) return fallback();
  const fitsAt = (cx: number, cy: number, w: number, h: number) => cropFits({ ...g, crop: { x: cx - w / 2, y: cy - h / 2, w, h } }, oSize);
  let cx = k.x + k.w / 2;
  let cy = k.y + k.h / 2;
  let w = k.w;
  let h = k.h;
  const towardCentre = (sw: number, sh: number) => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < STEPS; i++) {
      const t = (lo + hi) / 2;
      if (fitsAt(cx + t * (0.5 - cx), cy + t * (0.5 - cy), sw, sh)) hi = t;
      else lo = t;
    }
    cx += hi * (0.5 - cx);
    cy += hi * (0.5 - cy);
  };
  if (!fitsAt(cx, cy, 0, 0)) towardCentre(0, 0);
  if (!fitsAt(cx, cy, w, h)) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < STEPS; i++) {
      const s = (lo + hi) / 2;
      if (fitsAt(cx, cy, w * s, h * s)) lo = s;
      else hi = s;
    }
    w *= lo;
    h *= lo;
  }
  if (!(w > 0 && h > 0)) return fallback();
  if (w < m.w || h < m.h) {
    const s = Math.max(m.w / w, m.h / h);
    w *= s;
    h *= s;
    if (!fitsAt(cx, cy, w, h)) {
      if (!fitsAt(0.5, 0.5, w, h)) return fallback();
      towardCentre(w, h);
    }
  }
  return { ...g, crop: { x: cx - w / 2, y: cy - h / 2, w, h } };
}

/** 旋轉: the view turns 90° counter-clockwise; the crop follows the content (S §3.3) */
export function rotateLeft(g: Geometry): Geometry {
  const c = g.crop;
  return { ...g, quarter: ((g.quarter + 3) % 4) as Quarter, crop: { x: c.y, y: 1 - c.x - c.w, w: c.h, h: c.w } };
}

/** 翻轉 in the view, canonical form F∘R_q = R_{−q}∘F (C §3.5) */
export function flipView(g: Geometry): Geometry {
  return {
    flipH: !g.flipH,
    quarter: ((4 - g.quarter) % 4) as Quarter,
    straighten: g.straighten === 0 ? 0 : -g.straighten,
    crop: { ...g.crop, x: 1 - g.crop.x - g.crop.w },
  };
}

export function clampStraighten(theta: number): number {
  if (!Number.isFinite(theta)) return 0;
  const r = Math.round(Math.max(-45, Math.min(45, theta)) * 10) / 10;
  return r === 0 ? 0 : r;
}

/**
 * one 拉直 drag step, always from the gesture's start geometry (S §3.3). A max-fit start stays a max-fit of its aspect;
 * when that is under the minimum size at θ (a wide panorama turned far), cropConstrain picks the nearest valid aspect.
 */
export function setStraighten(start: Geometry, theta: number, oSize: Size): Geometry {
  const t = clampStraighten(theta);
  if (t === start.straighten) return start;
  if (isMaxFit(start, oSize)) {
    const e = eSize(start, oSize);
    const fitted: Geometry = { ...start, straighten: t, crop: maxFit(t, e.width, e.height, cropAspectPx(start, oSize)) };
    return cropValid(fitted, oSize) ? fitted : cropConstrain(fitted, oSize);
  }
  return cropConstrain({ ...start, straighten: t }, oSize);
}

// ── ratio locks (S §2.1; the ratio is width:height like the camera's RATIO_VALUE, ui/state.ts:14) ──

export type CropLock = 'free' | 'original' | '1:1' | '3:4' | '4:3' | '9:16' | '16:9';
export const CROP_LOCKS: readonly CropLock[] = ['free', 'original', '1:1', '3:4', '4:3', '9:16', '16:9'];
const FIXED: Record<Exclude<CropLock, 'free' | 'original'>, number> = { '1:1': 1, '3:4': 3 / 4, '4:3': 4 / 3, '9:16': 9 / 16, '16:9': 16 / 9 };

/** pixel aspect of a lock; 原比例 = the E frame's aspect; 自由 = null */
export function lockAspect(lock: CropLock, g: Pick<Geometry, 'quarter'>, oSize: Size): number | null {
  if (lock === 'free') return null;
  if (lock === 'original') {
    const e = eSize(g, oSize);
    return e.width / e.height;
  }
  return FIXED[lock];
}

/**
 * the centred max-fit of the lock's aspect; unchanged for 自由, when the crop already has that aspect, or when that
 * max-fit is under the minimum size (9:16 on a wide panorama): then no crop of the aspect is valid (see cropConstrain)
 */
export function applyRatio(g: Geometry, lock: CropLock, oSize: Size): Geometry {
  const a = lockAspect(lock, g, oSize);
  if (a === null || Math.abs(cropAspectPx(g, oSize) / a - 1) <= 0.005) return g;
  const e = eSize(g, oSize);
  const fitted: Geometry = { ...g, crop: maxFit(g.straighten, e.width, e.height, a) };
  return cropValid(fitted, oSize) ? fitted : g;
}

export function lockFor(g: Geometry, oSize: Size): CropLock {
  if (isFullCrop(g.crop)) return 'free';
  const a = cropAspectPx(g, oSize);
  for (const l of CROP_LOCKS) {
    if (l === 'free') continue;
    const b = lockAspect(l, g, oSize)!;
    if (Math.abs(a / b - 1) <= 0.005) return l;
  }
  return 'free';
}

export function transposeLock(l: CropLock): CropLock {
  switch (l) {
    case '3:4':
      return '4:3';
    case '4:3':
      return '3:4';
    case '9:16':
      return '16:9';
    case '16:9':
      return '9:16';
    default:
      return l;
  }
}

// ── crop mode (S §2.1, §3.2) ──

export interface CropLayout {
  /** the upright E frame fitted into the stage minus the inset, stage px */
  eBox: Rect;
  /** the canvas CSS box before its transform: the O aspect, centred on eBox, stage px */
  canvas: Rect;
  /** CSS `scaleX(sx) rotate(angle deg)`: equal to `rotate(θ + 90°·q) scaleX(±1)`, written mirror-first so a 翻轉 animates as a pure mirror */
  sx: 1 | -1;
  /** degrees, unwrapped toward the previous angle so 270° → 0° turns 90° */
  angle: number;
  /** the crop box, stage px (axis-aligned: the crop is axis-aligned in the plane) */
  cropBox: Rect;
}

export function cropModeLayout(stage: Size, oSize: Size, g: Geometry, inset = 24, prevAngle?: number): CropLayout {
  const e = eSize(g, oSize);
  const aw = Math.max(1, stage.width - 2 * inset);
  const ah = Math.max(1, stage.height - 2 * inset);
  const k = Math.min(aw / e.width, ah / e.height);
  const eBox: Rect = { x: (stage.width - e.width * k) / 2, y: (stage.height - e.height * k) / 2, w: e.width * k, h: e.height * k };
  const cx = eBox.x + eBox.w / 2;
  const cy = eBox.y + eBox.h / 2;
  const cw = oSize.width * k;
  const ch = oSize.height * k;
  const sx: 1 | -1 = g.flipH ? -1 : 1;
  const target = sx * (g.straighten + 90 * g.quarter);
  const angle = prevAngle === undefined ? target : prevAngle + (((((target - prevAngle) % 360) + 540) % 360) - 180);
  return {
    eBox,
    canvas: { x: cx - cw / 2, y: cy - ch / 2, w: cw, h: ch },
    sx,
    angle,
    cropBox: { x: eBox.x + g.crop.x * eBox.w, y: eBox.y + g.crop.y * eBox.h, w: g.crop.w * eBox.w, h: g.crop.h * eBox.h },
  };
}

export function cssTurn(l: Pick<CropLayout, 'sx' | 'angle'>): string {
  return `scaleX(${l.sx}) rotate(${l.angle}deg)`;
}

// ── overlays in normal mode (S §2.2) ──

/** V-normalized bounding box of O-space (x, y) pairs (a face oval: the drawn face box) */
export function ovalViewBox(points: Float32Array, g: Geometry, oSize: Size): Rect {
  const m = oToV(g, oSize);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i + 1 < points.length; i += 2) {
    const [x, y] = apply(m, [points[i], points[i + 1]]);
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** a person chip's O thumbnail shown upright (θ ignored) */
export function chipTransform(g: Pick<Geometry, 'flipH' | 'quarter'>): string {
  return `rotate(${90 * g.quarter}deg) scaleX(${g.flipH ? -1 : 1})`;
}

/** the E frame inside the V frame, in % of the frame, rotated by θ about its centre: the 增高 lines are E rows */
export function bandPlane(g: Geometry): { left: number; top: number; width: number; height: number; rotate: number } {
  const k = g.crop;
  const z = (v: number) => (v === 0 ? 0 : v); // no −0 in styles or snapshots
  return { left: z((-k.x / k.w) * 100), top: z((-k.y / k.h) * 100), width: 100 / k.w, height: 100 / k.h, rotate: g.straighten };
}

/** the E row under a V point (a 增高 drag: client → V → E, C §3.5) */
export function eYAt(g: Geometry, oSize: Size, v: Vec2): number {
  return apply(vToE(g, oSize), v)[1];
}
