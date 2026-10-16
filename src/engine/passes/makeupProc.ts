// Procedural makeup (face-detail spec §4.6–4.10): 眉毛, 眼影, 眼線, 睫毛, 臥蠶, 修容, 高光 and 美瞳, drawn in P1 after every
// face's GPUPixel lip/blush mesh. The geometry is built here on the CPU, in landmark space: every layer is ONE
// TRIANGLE_STRIP over every face (pieces joined by degenerate vertices), so a frame draws at most 9 strips for any number
// of faces. Original work (LICENSES/NOTICE.txt); no third-party makeup asset.
import { MAX_RENDER_FACES } from '../../config/limits';
import type { Face, Rect, RenderFace } from '../../types';
import { bindTarget, bindTexture, createProgram, createTexture, deleteTexture, type Framebuffer, type GL, hexToRgb, type Texture } from '../gl/gl';
import { MAKEUP_FIXED, ORIG_TINT, shadeColor } from '../params';
import {
  browGapAt,
  eyeFrames,
  eyeToUv,
  lashBlinkGate,
  lashSizeGate,
  lensBlinkGate,
  lidStations,
  STATION_XS,
  type EyeFrame,
  type Station,
  type V2,
} from './eyeFrame';
import { faceWidthIso, yawAttenuation } from './reshape';

export type MakeupLayer = 'contour' | 'highlight' | 'brow' | 'shadow' | 'aegyoLight' | 'aegyoShade' | 'lens' | 'liner' | 'lashes';
/** draw order (S5 §4.6): the lens reads `src`, so only lid items and the lashes, drawn after it, overlap the iris */
export const LAYER_ORDER: readonly MakeupLayer[] = ['contour', 'highlight', 'brow', 'shadow', 'aegyoLight', 'aegyoShade', 'lens', 'liner', 'lashes'];
/** 0 multiply (DST_COLOR, ZERO) · 1 screen (ONE, ONE_MINUS_SRC_COLOR) · 2 over (SRC_ALPHA, ONE_MINUS_SRC_ALPHA) */
export const LAYER_MODE: Readonly<Record<MakeupLayer, 0 | 1 | 2>> = {
  contour: 0,
  highlight: 1,
  brow: 0,
  shadow: 0,
  aegyoLight: 1,
  aegyoShade: 0,
  lens: 2,
  liner: 2,
  lashes: 2,
};
/** the shape enum PMAKEUP_FS switches on (aKind) */
export const KIND = {
  shadowUpper: 0,
  shadowLower: 1,
  liner: 2,
  lashes: 3,
  aegyoLight: 4,
  aegyoShade: 5,
  lens: 6,
  lensOrig: 7,
  brow: 8,
  contourJaw: 9,
  contourEllipse: 10,
  contourNose: 11,
  highlightRibbon: 12,
  highlightEllipse: 13,
} as const;
/** aPos 2 (O-space UV) · aLoc 2 · aAux 2 · aCol 4 (tint RGB, α_max) · aKind 1 — 44 B */
export const FLOATS_PER_VERTEX = 11;
export const MAX_PMAKEUP_VERTS_PER_FACE = 768;

export interface MakeupGeometry {
  data: Float32Array;
  ranges: Record<MakeupLayer, [first: number, count: number]>;
}

type RGBA = readonly [number, number, number, number];
const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** One TRIANGLE_STRIP per layer; pieces joined by degenerate vertices that start every piece on an even index. */
export class StripWriter {
  data: Float32Array;
  n = 0;
  private start = 0;
  private pending = false;
  constructor(data: Float32Array) {
    this.data = data;
  }
  beginLayer(): void {
    this.start = this.n;
    this.pending = false;
  }
  range(): [number, number] {
    return [this.start, this.n - this.start];
  }
  beginPiece(): void {
    if (this.n > this.start) {
      this.copyLast();
      this.pending = true;
    }
  }
  vertex(pos: V2, loc: V2, aux: V2, col: RGBA, kind: number): void {
    if (this.pending) {
      this.write(pos, loc, aux, col, kind);
      if ((this.n - this.start) % 2 === 1) this.write(pos, loc, aux, col, kind);
      this.pending = false;
    }
    this.write(pos, loc, aux, col, kind);
  }
  private grow(): void {
    if ((this.n + 1) * FLOATS_PER_VERTEX <= this.data.length) return;
    const next = new Float32Array(Math.max(this.data.length * 2, FLOATS_PER_VERTEX * MAX_PMAKEUP_VERTS_PER_FACE));
    next.set(this.data);
    this.data = next;
  }
  private copyLast(): void {
    this.grow();
    const o = this.n * FLOATS_PER_VERTEX;
    this.data.copyWithin(o, o - FLOATS_PER_VERTEX, o);
    this.n++;
  }
  private write(pos: V2, loc: V2, aux: V2, col: RGBA, kind: number): void {
    this.grow();
    const o = this.n * FLOATS_PER_VERTEX;
    const d = this.data;
    d[o] = pos[0];
    d[o + 1] = pos[1];
    d[o + 2] = loc[0];
    d[o + 3] = loc[1];
    d[o + 4] = aux[0];
    d[o + 5] = aux[1];
    d[o + 6] = col[0];
    d[o + 7] = col[1];
    d[o + 8] = col[2];
    d[o + 9] = col[3];
    d[o + 10] = kind;
    this.n++;
  }
}

interface FaceCtx {
  P: Float32Array;
  face: Face;
  aspect: number;
  fw: number;
  /** iso unit axes: m̂ toward the chin, r̂ from the GPUPixel-left eye toward the right eye */
  mh: V2;
  rh: V2;
  frames: readonly [EyeFrame, EyeFrame];
  /** α factor per GPUPixel side for 修容 and the 高光 cheekbone: the yaw far side × yawAttenuation (S5 §4.9) */
  sideAtt: readonly [number, number];
  I: { brow: number; eyeshadow: number; liner: number; lashes: number; aegyo: number; contour: number; highlight: number; lens: number };
  shades: { brow: string | null; eyeshadow: string | null; liner: string | null; lens: string | null };
}

const rgba = (hex: string, a: number): RGBA => {
  const c = hexToRgb(hex);
  return [c[0], c[1], c[2], a];
};

function faceCtx(rf: RenderFace, aspect: number): FaceCtx {
  const P = rf.face.pts111;
  const iso = (i: number): V2 => [P[i * 2], P[i * 2 + 1] / aspect];
  const m0 = iso(43);
  const m1 = iso(16);
  const ml = Math.hypot(m1[0] - m0[0], m1[1] - m0[1]) || 1e-12;
  const mh: V2 = [(m1[0] - m0[0]) / ml, (m1[1] - m0[1]) / ml];
  const e0 = iso(74);
  const e1 = iso(77);
  const r0: V2 = [-mh[1], mh[0]];
  const rh: V2 = r0[0] * (e1[0] - e0[0]) + r0[1] * (e1[1] - e0[1]) < 0 ? [-r0[0], -r0[1]] : r0;
  const w = clamp01(rf.weight);
  const v = (id: keyof RenderFace['person']['values']) => clamp01(rf.person.values[id]) * w;
  // yawProxy > 0: the GPUPixel-left eye is farther from the nose tip, so the GPUPixel-right half is the far side
  const att = yawAttenuation(rf.face.yaw);
  const sideAtt: [number, number] = rf.face.yaw > 0 ? [1, att] : rf.face.yaw < 0 ? [att, 1] : [1, 1];
  return {
    P,
    face: rf.face,
    aspect,
    fw: faceWidthIso(rf.face, aspect),
    mh,
    rh,
    frames: eyeFrames(rf.face, aspect),
    sideAtt,
    I: {
      brow: v('makeup.brow'),
      eyeshadow: v('makeup.eyeshadow'),
      liner: v('makeup.liner'),
      lashes: v('makeup.lashes'),
      aegyo: v('makeup.aegyo'),
      contour: v('makeup.contour'),
      highlight: v('makeup.highlight'),
      lens: v('makeup.lens'),
    },
    shades: {
      brow: rf.person.shades.brow,
      eyeshadow: rf.person.shades.eyeshadow,
      liner: rf.person.shades.liner,
      lens: rf.person.shades.lens,
    },
  };
}

const uvOf = (c: FaceCtx, q: V2): V2 => [q[0], q[1] * c.aspect];
const isoPt = (c: FaceCtx, i: number): V2 => [c.P[i * 2], c.P[i * 2 + 1] / c.aspect];
const isoExt = (c: FaceCtx, k: number): V2 => [c.face.ext[k * 2], c.face.ext[k * 2 + 1] / c.aspect];
const lerp = (a: V2, b: V2, t: number): V2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const unit = (v: V2): V2 => {
  const l = Math.hypot(v[0], v[1]) || 1e-12;
  return [v[0] / l, v[1] / l];
};

/** a strip of station pairs along a lid: (point + n·d0, point + n·d1); aLoc defaults to (u, d) = (station x, offset) */
function eyeRibbon(
  w: StripWriter,
  c: FaceCtx,
  f: EyeFrame,
  sts: readonly Station[],
  d0: number,
  d1: (s: Station) => number,
  aux: (s: Station) => V2,
  col: RGBA,
  kind: number,
  loc: (s: Station, d: number, edge: 0 | 1) => V2 = (s, d) => [s.x, d],
): void {
  w.beginPiece();
  for (const s of sts) {
    const b = d1(s);
    w.vertex(eyeToUv(f, s.x + s.nx * d0, s.y + s.ny * d0, c.aspect), loc(s, d0, 0), aux(s), col, kind);
    w.vertex(eyeToUv(f, s.x + s.nx * b, s.y + s.ny * b, c.aspect), loc(s, b, 1), aux(s), col, kind);
  }
}

/** octagon circumscribing the ellipse (centre ctr, unit axis a, half-axes A, B; iso), so no corner pokes out of the face */
const OCT_R = 1 / Math.cos(Math.PI / 8);
const OCT_ORDER = [0, 1, 7, 2, 6, 3, 5, 4];
function ellipse(w: StripWriter, c: FaceCtx, ctr: V2, a: V2, A: number, B: number, aux: V2, col: RGBA, kind: number): void {
  const b: V2 = [-a[1], a[0]];
  w.beginPiece();
  for (const k of OCT_ORDER) {
    const t = ((k + 0.5) * Math.PI) / 4;
    const xi = OCT_R * Math.cos(t);
    const eta = OCT_R * Math.sin(t);
    const q: V2 = [ctr[0] + a[0] * A * xi + b[0] * B * eta, ctr[1] + a[1] * A * xi + b[1] * B * eta];
    w.vertex(uvOf(c, q), [xi, eta], aux, col, kind);
  }
}

/** a straight ribbon from p to q (iso), `width` (iso) across and centred; aLoc = (u, v) */
function segment(w: StripWriter, c: FaceCtx, p: V2, q: V2, width: number, col: RGBA, kind: number): void {
  const n = unit([-(q[1] - p[1]), q[0] - p[0]]);
  const h = width / 2;
  w.beginPiece();
  for (const [u, s] of [
    [0, p],
    [1, q],
  ] as const) {
    w.vertex(uvOf(c, [s[0] - n[0] * h, s[1] - n[1] * h]), [u, 0], [0, 0], col, kind);
    w.vertex(uvOf(c, [s[0] + n[0] * h, s[1] + n[1] * h]), [u, 1], [0, 0], col, kind);
  }
}

/** inward unit normal (iso) of contour point i: ⊥ (p[i+1] − p[i−1]), toward the nose tip p46 */
function inward(c: FaceCtx, i: number): V2 {
  const a = isoPt(c, i - 1);
  const b = isoPt(c, i + 1);
  const n = unit([-(b[1] - a[1]), b[0] - a[0]]);
  const p = isoPt(c, i);
  const t = isoPt(c, 46);
  return n[0] * (t[0] - p[0]) + n[1] * (t[1] - p[1]) < 0 ? [-n[0], -n[1]] : n;
}

const UPPER_XS = [-0.22, -0.14, -0.07, ...STATION_XS];
const LOWER_ACCENT_XS = [-0.15, -0.075, ...STATION_XS.filter((x) => x <= 0.5), 0.55];
const AEGYO_XS = Array.from({ length: 17 }, (_, k) => 0.05 + (0.95 * k) / 16);
const LINER_T = (x: number) => 0.045 * (0.35 + 0.65 * (1 - x));
const LASH_X = [-0.2, 0, 0.15, 0.5, 0.8, 0.95, 1];
const LASH_H = [0.12, 0.12, 0.2, 0.2, 0.13, 0.08, 0];

/** 睫毛 length (eye units) over the lid x (S5 §4.8): piecewise linear, constant below −0.2 */
export function lashHeight(x: number): number {
  if (x <= LASH_X[0]) return LASH_H[0];
  for (let j = 1; j < LASH_X.length; j++) {
    if (x <= LASH_X[j]) {
      const t = (x - LASH_X[j - 1]) / (LASH_X[j] - LASH_X[j - 1]);
      return LASH_H[j - 1] + t * (LASH_H[j] - LASH_H[j - 1]);
    }
  }
  return 0;
}

// ── layers (S5 §4.8) ──
function contour(w: StripWriter, c: FaceCtx): void {
  if (c.I.contour <= 0) return;
  const sides: readonly (readonly number[])[] = [
    [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
    [30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18],
  ];
  sides.forEach((idx, side) => {
    const a = c.I.contour * c.sideAtt[side];
    if (a <= 0) return;
    const col = rgba(MAKEUP_FIXED.contour, a);
    w.beginPiece();
    idx.forEach((i, j) => {
      const p = isoPt(c, i);
      const n = inward(c, i);
      const u = j / (idx.length - 1);
      w.vertex(uvOf(c, p), [u, 0], [0, 0], col, KIND.contourJaw);
      w.vertex(uvOf(c, [p[0] + n[0] * 0.1 * c.fw, p[1] + n[1] * 0.1 * c.fw]), [u, 1], [0, 0], col, KIND.contourJaw);
    });
    const [p0, p1] = side === 0 ? [isoPt(c, 4), isoPt(c, 84)] : [isoPt(c, 28), isoPt(c, 90)];
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    ellipse(w, c, lerp(p0, p1, 0.3), unit([p1[0] - p0[0], p1[1] - p0[1]]), 0.3 * len, 0.085 * len, [0, 0], col, KIND.contourEllipse);
    const [n0, n1] = side === 0 ? [isoPt(c, 78), isoPt(c, 82)] : [isoPt(c, 79), isoPt(c, 83)];
    segment(w, c, n0, n1, 0.035 * c.fw, col, KIND.contourNose);
  });
}

function highlight(w: StripWriter, c: FaceCtx): void {
  if (c.I.highlight <= 0) return;
  const col = rgba(MAKEUP_FIXED.highlight, c.I.highlight);
  segment(w, c, isoPt(c, 43), isoPt(c, 45), 0.055 * c.fw, col, KIND.highlightRibbon);
  (
    [
      [57, 2],
      [62, 30],
    ] as const
  ).forEach(([a, b], side) => {
    const s = c.I.highlight * c.sideAtt[side];
    if (s <= 0) return;
    const p0 = isoPt(c, a);
    const p1 = isoPt(c, b);
    ellipse(w, c, lerp(p0, p1, 0.45), unit([p1[0] - p0[0], p1[1] - p0[1]]), 0.11 * c.fw, 0.05 * c.fw, [0.3, 0], rgba(MAKEUP_FIXED.highlight, s), KIND.highlightEllipse);
  });
  ellipse(w, c, lerp(isoExt(c, 1), isoExt(c, 2), 0.35), c.rh, 0.13 * c.fw, 0.07 * c.fw, [0.22, 0], col, KIND.highlightEllipse);
  ellipse(w, c, lerp(isoPt(c, 16), isoPt(c, 93), 0.4), c.rh, 0.06 * c.fw, 0.035 * c.fw, [0.25, 0], col, KIND.highlightEllipse);
}

/** arc-length resampling of an iso polyline to n points */
function resample(pts: readonly V2[], n: number): V2[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];
  const out: V2[] = [];
  let j = 1;
  for (let k = 0; k < n; k++) {
    const t = (total * k) / (n - 1);
    while (j < pts.length - 1 && cum[j] < t) j++;
    const seg = cum[j] - cum[j - 1] || 1e-12;
    out.push(lerp(pts[j - 1], pts[j], Math.min(1, Math.max(0, (t - cum[j - 1]) / seg))));
  }
  return out;
}

function brow(w: StripWriter, c: FaceCtx): void {
  if (c.I.brow <= 0) return;
  const col = rgba(shadeColor('brow', c.shades.brow) ?? ORIG_TINT.brow, c.I.brow);
  const sides = [
    [
      [33, 34, 35, 36, 37],
      [64, 65, 66, 67],
    ],
    [
      [42, 41, 40, 39, 38],
      [71, 70, 69, 68],
    ],
  ] as const;
  for (const [up, lo] of sides) {
    const U = up.map((i) => isoPt(c, i));
    const L = resample(
      lo.map((i) => isoPt(c, i)),
      5,
    );
    // tail extension at u = −0.12 (stations 0.25 apart in u), then each edge pushed out by 8 % of the local width
    const ext = (e: V2[]): V2[] => [lerp(e[0], e[1], -0.12 / 0.25), ...e];
    const Ue = ext(U);
    const Le = ext(L);
    w.beginPiece();
    [-0.12, 0, 0.25, 0.5, 0.75, 1].forEach((u, j) => {
      const a = Ue[j];
      const b = Le[j];
      const dx = (a[0] - b[0]) * 0.08;
      const dy = (a[1] - b[1]) * 0.08;
      w.vertex(uvOf(c, [b[0] - dx, b[1] - dy]), [u, 0], [0, 0], col, KIND.brow);
      w.vertex(uvOf(c, [a[0] + dx, a[1] + dy]), [u, 1], [0, 0], col, KIND.brow);
    });
  }
}

function shadow(w: StripWriter, c: FaceCtx): void {
  if (c.I.eyeshadow <= 0) return;
  const col = rgba(shadeColor('eyeshadow', c.shades.eyeshadow) ?? ORIG_TINT.eyeshadow, c.I.eyeshadow);
  for (const f of c.frames) {
    const H = (s: Station) => 0.65 * Math.max(browGapAt(f, s.x, s.y), 0.25);
    eyeRibbon(w, c, f, lidStations(f, 'upper', UPPER_XS), -0.02, H, (s) => [H(s), 0], col, KIND.shadowUpper);
    eyeRibbon(w, c, f, lidStations(f, 'lower', LOWER_ACCENT_XS), -0.03, () => 0.1, () => [0, 0], col, KIND.shadowLower);
  }
}

function aegyo(w: StripWriter, c: FaceCtx, light: boolean): void {
  if (c.I.aegyo <= 0) return;
  const col = rgba(light ? MAKEUP_FIXED.aegyoLight : MAKEUP_FIXED.aegyoShade, c.I.aegyo);
  for (const f of c.frames) {
    eyeRibbon(w, c, f, lidStations(f, 'lower', AEGYO_XS), 0, () => 0.16, () => [0, 0], col, light ? KIND.aegyoLight : KIND.aegyoShade);
  }
}

function lens(w: StripWriter, c: FaceCtx): void {
  if (c.I.lens <= 0) return;
  const hex = shadeColor('lens', c.shades.lens);
  const kind = hex ? KIND.lens : KIND.lensOrig;
  for (const f of c.frames) {
    const a = c.I.lens * lensBlinkGate(f.ear);
    if (a <= 0) continue;
    let open = false;
    for (let k = 0; k < STATION_XS.length; k++) if (f.lower[k] - f.upper[k] > 0) open = true;
    if (!open) continue;
    const iris = f.iris ?? f.irisFallback;
    const col: RGBA = hex ? rgba(hex, a) : [0, 0, 0, a];
    w.beginPiece();
    STATION_XS.forEach((x, k) => {
      // the aperture strip: (dU, dL) = distances to the upper and lower lid, eye units
      const h = Math.max(0, f.lower[k] - f.upper[k]);
      for (const [y, aux] of [
        [f.upper[k], [0, h]],
        [f.upper[k] + h, [h, 0]],
      ] as const) {
        const q = eyeToUv(f, x, y, c.aspect);
        w.vertex(q, [(q[0] - iris.c[0]) / iris.r, (q[1] / c.aspect - iris.c[1]) / iris.r], [aux[0], aux[1]], col, kind);
      }
    });
  }
}

function liner(w: StripWriter, c: FaceCtx): void {
  if (c.I.liner <= 0) return;
  const col = rgba(shadeColor('liner', c.shades.liner) ?? '#151313', c.I.liner);
  for (const f of c.frames) {
    eyeRibbon(w, c, f, lidStations(f, 'upper', STATION_XS), -0.03, (s) => LINER_T(s.x) + 0.02, (s) => [LINER_T(s.x), 0], col, KIND.liner);
    // wing: 3 stations from the outer corner toward (−0.16, −0.07) in eye units, tapering to nothing (S5 §4.8)
    const dir: V2 = [-0.16, -0.07];
    const n = unit([-dir[1], dir[0]]);
    const up: V2 = n[1] < 0 ? n : [-n[0], -n[1]];
    const y0 = f.upperPts[1];
    const sts: Station[] = [0, 0.5, 1].map((s) => ({ x: dir[0] * s, y: y0 + dir[1] * s, nx: up[0], ny: up[1] }));
    const T = (s: Station) => LINER_T(0) * (1 - s.x / dir[0]);
    eyeRibbon(w, c, f, sts, -0.03, (s) => T(s) + 0.02, (s) => [T(s), 0], col, KIND.liner, (_s, d) => [0, d]);
  }
}

function lashes(w: StripWriter, c: FaceCtx): void {
  if (c.I.lashes <= 0) return;
  for (const f of c.frames) {
    const a = c.I.lashes * lashBlinkGate(f.ear) * lashSizeGate(f, c.aspect);
    if (a <= 0) continue;
    const col = rgba(MAKEUP_FIXED.lashes, a);
    eyeRibbon(w, c, f, lidStations(f, 'upper', UPPER_XS), 0, (s) => lashHeight(s.x), () => [0, 0], col, KIND.lashes, (s, _d, edge) => [(s.x + 0.2) / 1.2, edge]);
  }
}

const EMITTERS: Readonly<Record<MakeupLayer, (w: StripWriter, c: FaceCtx) => void>> = {
  contour,
  highlight,
  brow,
  shadow,
  aegyoLight: (w, c) => aegyo(w, c, true),
  aegyoShade: (w, c) => aegyo(w, c, false),
  lens,
  liner,
  lashes,
};

const PROC_IDS = [
  'makeup.brow', 'makeup.eyeshadow', 'makeup.liner', 'makeup.lashes', 'makeup.aegyo', 'makeup.contour', 'makeup.highlight', 'makeup.lens',
] as const;

/** any listed face has a procedural part above 0 (before the gates): the cheap pre-check before building geometry */
export function procMakeupWanted(faces: readonly RenderFace[]): boolean {
  return faces.some((f) => clamp01(f.weight) > 0 && PROC_IDS.some((id) => clamp01(f.person.values[id]) > 0));
}

/**
 * Everything buildMakeupGeometry reads, as a flat list compared with Object.is (the engine's per-frame memo): the aspect,
 * then per face its Face object (landmarks and yaw: never mutated, a new detection is a new object), weight, the eight
 * procedural values and the four procedural shades.
 */
export function procMakeupKey(faces: readonly RenderFace[], aspect: number): unknown[] {
  const k: unknown[] = [aspect];
  for (const f of faces) {
    k.push(f.face, f.weight);
    for (const id of PROC_IDS) k.push(f.person.values[id]);
    const s = f.person.shades;
    k.push(s.brow, s.eyeshadow, s.liner, s.lens);
  }
  return k;
}

export function geometryVertexCount(g: MakeupGeometry): number {
  return LAYER_ORDER.reduce((n, l) => n + g.ranges[l][1], 0);
}

/**
 * W/H of the whole O frame: step 3's `RenderInput.oAspect` when given (tiles pass the working bitmap's, so the makeup
 * geometry matches the reshape's), else the source size over its `sourceWindow` (RM §4.1)
 */
export function oAspectOf(input: { width: number; height: number; sourceWindow?: Rect; oAspect?: number }): number {
  if (input.oAspect !== undefined && input.oAspect > 0) return input.oAspect;
  const win = input.sourceWindow ?? { x: 0, y: 0, w: 1, h: 1 };
  return input.width / win.w / (input.height / win.h);
}

/** Every layer is one TRIANGLE_STRIP over every face, in LAYER_ORDER; `out` is reused when it is large enough. */
export function buildMakeupGeometry(faces: readonly RenderFace[], aspect: number, out?: Float32Array): MakeupGeometry {
  const cap = Math.max(1, faces.length) * MAX_PMAKEUP_VERTS_PER_FACE * FLOATS_PER_VERTEX;
  const w = new StripWriter(out && out.length >= cap ? out : new Float32Array(cap));
  const ctxs = faces.filter((f) => clamp01(f.weight) > 0).map((f) => faceCtx(f, aspect));
  const ranges = {} as Record<MakeupLayer, [number, number]>;
  for (const layer of LAYER_ORDER) {
    w.beginLayer();
    for (const c of ctxs) EMITTERS[layer](w, c);
    ranges[layer] = w.range();
  }
  return { data: w.data, ranges };
}

/** aPos is O-space UV; uWin maps it to the target (identity untiled; a tile's O window otherwise, step 3) */
export const PMAKEUP_VS = /* glsl */ `#version 300 es
in vec2 aPos;
in vec2 aLoc;
in vec2 aAux;
in vec4 aCol;
in float aKind;
uniform vec4 uWin;
out vec2 vLoc;
out vec2 vAux;
out vec4 vCol;
flat out int vKind;
void main() {
  vLoc = aLoc;
  vAux = aAux;
  vCol = aCol;
  vKind = int(aKind + 0.5);
  vec2 q = (aPos - uWin.xy) / uWin.zw;
  gl_Position = vec4(q * 2.0 - 1.0, 0.0, 1.0);
}`;

/** Every kind's α and colour (face-detail spec §4.8, §4.9); pinned to makeupProcCpu.ts by makeupProcCpu.test.ts */
export const PMAKEUP_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vLoc;
in vec2 vAux;
in vec4 vCol;
flat in int vKind;
uniform sampler2D uSrc;
uniform sampler2D uLashes;
uniform vec2 uInvDst;
uniform int uLayerMode; // 0 multiply, 1 screen, 2 over (LAYER_MODE in makeupProc.ts)
out vec4 outColor;

float band(float y, float a, float b, float f) { return smoothstep(a - f, a + f, y) * (1.0 - smoothstep(b - f, b + f, y)); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float skinGate(vec3 c) { return smoothstep(0.06, 0.14, luma(c)) * smoothstep(0.005, 0.04, c.r - c.b); }

void main() {
  // every derivative and implicit-LOD fetch runs in uniform control flow, before the kind branches
  vec3 src = texture(uSrc, gl_FragCoord.xy * uInvDst).rgb;
  float lash = texture(uLashes, vec2(vLoc.x, 1.0 - vLoc.y)).r;
  float fwD = fwidth(vLoc.y);
  float fwU = fwidth(18.0 * vLoc.x);
  float u = vLoc.x;
  float d = vLoc.y;
  vec3 rgb = vCol.rgb;
  float a = 0.0;
  if (vKind == 0) {
    float H = vAux.x;
    float h = smoothstep(-0.22, 0.02, u) * (1.0 - smoothstep(0.80, 1.02, u)) * (0.55 + 0.45 * (1.0 - u));
    a = smoothstep(-0.02, 0.01, d) * (1.0 - smoothstep(0.30 * H, H, d)) * h;
  } else if (vKind == 1) {
    a = 0.35 * band(d, 0.0, 0.07, 0.02) * smoothstep(-0.15, 0.05, u) * (1.0 - smoothstep(0.35, 0.55, u));
  } else if (vKind == 2) {
    float T = vAux.x;
    float f = max(0.75 * fwD, 0.004);
    a = smoothstep(-0.006 - f, -0.006 + f, d) * (1.0 - smoothstep(T - f, T + f, d)) * (1.0 - smoothstep(0.85, 1.0, u));
  } else if (vKind == 3) {
    a = lash;
  } else if (vKind == 4) {
    float v = d / 0.12;
    float h = smoothstep(0.10, 0.35, u) * (1.0 - smoothstep(0.80, 0.95, u));
    a = 0.45 * h * smoothstep(0.05, 0.35, v) * (1.0 - smoothstep(0.55, 0.85, v));
  } else if (vKind == 5) {
    float v = d / 0.12;
    float h = smoothstep(0.10, 0.35, u) * (1.0 - smoothstep(0.80, 0.95, u));
    a = 0.35 * h * band(v, 0.86, 1.0, 0.06);
  } else if (vKind == 6 || vKind == 7) {
    float rho = length(vLoc);
    float mask = 1.0 - smoothstep(1.04, 1.10, rho);
    float lid = smoothstep(0.0, 0.05, vAux.x) * smoothstep(0.0, 0.04, vAux.y);
    float Y = luma(src);
    float catchl = 1.0 - smoothstep(0.72, 0.88, Y);
    float ring = smoothstep(0.78, 0.92, rho);
    if (vKind == 6) {
      float th = rho > 1e-6 ? atan(vLoc.y, vLoc.x) : 0.0;
      a = mask * lid * catchl * smoothstep(0.30, 0.38, rho);
      rgb = vCol.rgb * (0.42 + 1.15 * Y) * (0.92 + 0.08 * sin(28.0 * th)) * mix(1.0, 0.55, ring) * (0.85 + 0.15 * smoothstep(0.0, 0.10, vAux.x));
    } else {
      a = mask * lid * catchl * ring;
      rgb = src * 0.55;
    }
  } else if (vKind == 8) {
    float tilt = mix(0.15, 0.7, smoothstep(0.6, 1.0, u));
    float stripe = 1.0 - smoothstep(0.15, 0.35, abs(fract(18.0 * u + tilt * 2.2 * d) - 0.5));
    float vis = 1.0 - smoothstep(0.25, 0.5, fwU);
    float strokes = mix(0.89, 0.78 + 0.22 * stripe, vis);
    a = smoothstep(0.0, 0.22, d) * (1.0 - smoothstep(0.78, 1.0, d)) * smoothstep(-0.12, 0.05, u) * mix(1.0, 0.45, smoothstep(0.70, 1.0, u)) * strokes;
  } else if (vKind == 9) {
    a = 0.55 * skinGate(src) * smoothstep(0.0, 0.18, d) * (1.0 - smoothstep(0.35, 1.0, d)) * smoothstep(0.0, 0.12, u) * (1.0 - smoothstep(0.88, 1.0, u));
  } else if (vKind == 10) {
    a = 0.45 * skinGate(src) * (1.0 - smoothstep(0.35, 1.0, dot(vLoc, vLoc)));
  } else if (vKind == 11) {
    a = 0.30 * skinGate(src) * (1.0 - smoothstep(0.3, 1.0, abs(2.0 * d - 1.0))) * smoothstep(0.0, 0.15, u) * (1.0 - smoothstep(0.75, 1.0, u));
  } else if (vKind == 12) {
    float q = abs(2.0 * d - 1.0);
    a = 0.35 * skinGate(src) * (1.0 - smoothstep(0.2, 1.0, q * q));
  } else if (vKind == 13) {
    a = vAux.x * skinGate(src) * (1.0 - smoothstep(0.2, 1.0, dot(vLoc, vLoc)));
  }
  a = clamp(a * vCol.a, 0.0, 1.0);
  if (uLayerMode == 0) outColor = vec4(mix(vec3(1.0), rgb, a), 1.0);
  else if (uLayerMode == 1) outColor = vec4(rgb * a, 1.0);
  else outColor = vec4(rgb, a);
}`;

export const LASHES_UNIT = 1;

export interface ProcMakeupPass {
  /**
   * Draw every non-empty layer of `geom` into `target` (its copy and the GPUPixel meshes are already there), reading
   * `src` (unit 0, never the target: no feedback loop) and `lashes` (unit 1; null skips the 睫毛 layer).
   * At most one drawArrays per layer. Returns the layers drawn.
   */
  draw(target: Framebuffer, geom: MakeupGeometry, src: Texture, lashes: Texture | null, win?: readonly [number, number, number, number]): MakeupLayer[];
  dispose(): void;
}

export function createProcMakeupPass(gl: GL): ProcMakeupPass {
  const prog = createProgram(gl, PMAKEUP_VS, PMAKEUP_FS, 'makeup-proc');
  prog.use();
  gl.uniform1i(prog.u('uSrc'), 0);
  gl.uniform1i(prog.u('uLashes'), LASHES_UNIT);
  const STRIDE = FLOATS_PER_VERTEX * 4;
  let capacity = MAX_RENDER_FACES * MAX_PMAKEUP_VERTS_PER_FACE * STRIDE;
  const vao = gl.createVertexArray();
  const vbo = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, capacity, gl.DYNAMIC_DRAW);
  const attr = (name: string, size: number, offset: number) => {
    const loc = gl.getAttribLocation(prog.program, name);
    if (loc < 0) return;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE, offset * 4);
  };
  attr('aPos', 2, 0);
  attr('aLoc', 2, 2);
  attr('aAux', 2, 4);
  attr('aCol', 4, 6);
  attr('aKind', 1, 10);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  // bound on the lashes unit when the texture is unavailable (its layer is skipped then), so no unit is empty
  const blank = createTexture(gl, 1, 1);

  return {
    draw(target, geom, src, lashes, win = [0, 0, 1, 1]) {
      let used = 0;
      for (const l of LAYER_ORDER) used = Math.max(used, geom.ranges[l][0] + geom.ranges[l][1]);
      const drawn: MakeupLayer[] = [];
      if (used === 0) return drawn;
      bindTarget(gl, target);
      prog.use();
      gl.uniform2f(prog.u('uInvDst'), 1 / target.width, 1 / target.height);
      gl.uniform4f(prog.u('uWin'), win[0], win[1], win[2], win[3]);
      bindTexture(gl, 0, src);
      bindTexture(gl, LASHES_UNIT, lashes ?? blank);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      if (used * STRIDE > capacity) {
        capacity = used * STRIDE;
        gl.bufferData(gl.ARRAY_BUFFER, capacity, gl.DYNAMIC_DRAW);
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, geom.data, 0, used * FLOATS_PER_VERTEX);
      gl.disable(gl.CULL_FACE); // strips join faces with degenerate vertices; nothing relies on winding
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      for (const layer of LAYER_ORDER) {
        const [first, count] = geom.ranges[layer];
        if (count < 3 || (layer === 'lashes' && !lashes)) continue;
        const mode = LAYER_MODE[layer];
        // destination alpha is kept at 1 by every mode (ZERO, ONE)
        if (mode === 0) gl.blendFuncSeparate(gl.DST_COLOR, gl.ZERO, gl.ZERO, gl.ONE);
        else if (mode === 1) gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_COLOR, gl.ZERO, gl.ONE);
        else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
        gl.uniform1i(prog.u('uLayerMode'), mode);
        gl.drawArrays(gl.TRIANGLE_STRIP, first, count);
        drawn.push(layer);
      }
      // back to the default factors, as heal.ts does: the MIN / MAX passes ignore them, but no later pass inherits a
      // layer's (DST_COLOR, …), (ONE, ONE_MINUS_SRC_COLOR, …) or (SRC_ALPHA, ONE_MINUS_SRC_ALPHA, …)
      gl.blendFunc(gl.ONE, gl.ZERO);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      bindTexture(gl, LASHES_UNIT, null);
      gl.activeTexture(gl.TEXTURE0);
      return drawn;
    },
    dispose() {
      prog.dispose();
      gl.deleteVertexArray(vao);
      gl.deleteBuffer(vbo);
      deleteTexture(gl, blank);
    },
  };
}
