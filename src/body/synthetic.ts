// Synthetic standing figure (pose + person mask + face anchors + a painter) for unit tests and the B1 harness.
// Not used by the app. Proportions follow a generic adult standing pose, arms slightly away from the body.
import type { BodyDetection, Face } from '../types';
import { FACE_TEMPLATE } from '../engine/passes/faceMesh';
import { segDist, type V2 } from './geom';

/**
 * Painted backgrounds. room / stripes / checker: B1's originals. The rest are the straightness scenes of
 * reports/美體修圖 背景扭曲 抑制技術.md (stage 0): plain wall plus only the lines `lines()` lists.
 * - doorClose: verticals 0.25 W, 0.5 W, 1 W and 2 W outside the waist silhouette on both sides (W = the waist
 *   half-width, so 0.25–0.5 W sit inside the trunk ring (R = 2 W from the axis), 1 W at its edge, 2 W outside):
 *   separates lines that emerge from behind the body (T-junctions) from free ones;
 * - tiles30: tile seams at 30° and −60° (two perpendicular families) over the whole frame;
 * - blinds: horizontal slats behind the head and neck (小頭 / 天鵝頸 / 直角肩);
 * - brick: horizontal courses with staggered vertical joints behind the legs (長腿 / 增高 ramps).
 */
export type BackgroundKind = 'room' | 'stripes' | 'checker' | 'doorClose' | 'tiles30' | 'blinds' | 'brick';

/** A straight painted background line, UV endpoints (clipped to the frame / its region), for per-line bend checks. */
export interface BgLine {
  a: [number, number];
  b: [number, number];
  /** e.g. 'door+0.25W R', 'tile30 #3', 'blind #2', 'brick-h #1', 'wall+0.05FW L' */
  tag: string;
}

export interface SyntheticOptions {
  width?: number;
  height?: number;
  /** mask long edge */
  maskEdge?: number;
  /** arms hanging against the torso (no background gap) */
  armsDown?: boolean;
  /** crop: only the upper body is in frame (legs / feet out) */
  halfBody?: boolean;
  /** visibility for every point */
  vis?: number;
}

export interface SyntheticFigure {
  det: BodyDetection;
  face: Face;
  /** person-ness (0..1) at UV, the exact shape the mask was rasterised from */
  inside(u: number, v: number): number;
  /** RGB at UV for a test photo: door frame + stripes + floor background, striped shirt, jeans */
  paint(u: number, v: number, background?: BackgroundKind): [number, number, number];
  /** the straight lines `paint` draws for this background (empty for room / stripes / checker) */
  lines(background: BackgroundKind): BgLine[];
  width: number;
  height: number;
}

type P = [number, number];

export function syntheticFigure(opts: SyntheticOptions = {}): SyntheticFigure {
  const W = opts.width ?? 600;
  const H = opts.height ?? 900;
  const A = W / H;
  const vis = opts.vis ?? 0.98;
  const half = opts.halfBody ?? false;
  // UV keypoints (person faces the camera: their left (11) is on the image right). halfBody zooms 2× on the chest.
  const z = (p: P): P => (half ? [0.5 + (p[0] - 0.5) * 2, 0.1 + (p[1] - 0.1) * 2] : p);
  const armsDown = opts.armsDown ?? false;
  const kpUV: Record<number, P> = {
    0: [0.5, 0.125],
    11: [0.585, 0.25],
    12: [0.415, 0.25],
    13: armsDown ? [0.6, 0.39] : [0.655, 0.385],
    14: armsDown ? [0.4, 0.39] : [0.345, 0.385],
    15: armsDown ? [0.605, 0.52] : [0.7, 0.515],
    16: armsDown ? [0.395, 0.52] : [0.3, 0.515],
    17: armsDown ? [0.61, 0.56] : [0.715, 0.555],
    18: armsDown ? [0.39, 0.56] : [0.285, 0.555],
    19: armsDown ? [0.6, 0.565] : [0.705, 0.56],
    20: armsDown ? [0.4, 0.565] : [0.295, 0.56],
    23: [0.545, 0.53],
    24: [0.455, 0.53],
    25: [0.55, 0.715],
    26: [0.45, 0.715],
    27: [0.552, 0.885],
    28: [0.448, 0.885],
    29: [0.552, 0.905],
    30: [0.448, 0.905],
    31: [0.575, 0.915],
    32: [0.425, 0.915],
  };
  const points = new Float32Array(33 * 4);
  for (let i = 0; i < 33; i++) {
    const p = z(kpUV[i] ?? kpUV[0]);
    points[i * 4] = p[0];
    points[i * 4 + 1] = p[1];
    points[i * 4 + 3] = vis;
  }
  // limbs in Q space with radii (Q units)
  const q = (i: number): V2 => {
    const p = z(kpUV[i]);
    return [p[0] * A, p[1]];
  };
  const s = half ? 2 : 1;
  const caps: [V2, V2, number][] = [
    [q(11), q(13), 0.024 * s],
    [q(13), q(15), 0.019 * s],
    [q(12), q(14), 0.024 * s],
    [q(14), q(16), 0.019 * s],
    [q(15), q(19), 0.016 * s],
    [q(16), q(20), 0.016 * s],
    [q(23), q(25), 0.042 * s],
    [q(25), q(27), 0.03 * s],
    [q(24), q(26), 0.042 * s],
    [q(26), q(28), 0.03 * s],
    [q(27), q(31), 0.017 * s],
    [q(28), q(32), 0.017 * s],
  ];
  const sMid: V2 = [(q(11)[0] + q(12)[0]) / 2, (q(11)[1] + q(12)[1]) / 2];
  const hMid: V2 = [(q(23)[0] + q(24)[0]) / 2, (q(23)[1] + q(24)[1]) / 2];
  const torsoLen = hMid[1] - sMid[1];
  const shoulderHalf = (q(11)[0] - q(12)[0]) / 2;
  // torso half-width profile along t (0 shoulders, 1 hips): chest, waist dip at t≈0.6, hips
  const torsoHalf = (t: number): number => {
    const tt = Math.min(t, 1.05);
    return shoulderHalf * (1.12 + 0.08 * tt - 0.32 * Math.exp(-(((tt - 0.6) / 0.22) ** 2)));
  };
  const headC: V2 = [q(0)[0], q(0)[1] - 0.012 * s];
  const headR: V2 = [0.045 * s, 0.06 * s];
  // conservative bounding box of every part below (a cheap reject; changes no result)
  const bb = [headC[0] - headR[0], headC[1] - headR[1], headC[0] + headR[0], headC[1] + headR[1]];
  const grow = (x: number, y: number, r: number) => {
    bb[0] = Math.min(bb[0], x - r);
    bb[1] = Math.min(bb[1], y - r);
    bb[2] = Math.max(bb[2], x + r);
    bb[3] = Math.max(bb[3], y + r);
  };
  for (const [a, b, r] of caps) for (const p of [a, b]) grow(p[0], p[1], r);
  for (const p of [q(11), q(12)]) grow(p[0], p[1], 0.035 * s);
  grow(sMid[0], sMid[1] - 0.1 * torsoLen, 1.21 * shoulderHalf);
  grow(sMid[0], sMid[1] + 1.14 * torsoLen, 1.21 * shoulderHalf);
  const insideQ = (x: number, y: number): boolean => {
    if (x < bb[0] || y < bb[1] || x > bb[2] || y > bb[3]) return false;
    const t = (y - sMid[1] + 0.02 * s) / torsoLen;
    if (t >= 0 && t <= 1.12 && Math.abs(x - sMid[0]) < torsoHalf(Math.max(0, t - 0.02))) return true;
    // shoulder caps
    if (t > -0.08 && t < 0.15 && segDist([x, y], q(11), q(12)) < 0.035 * s) return true;
    for (const [a, b, r] of caps) if (segDist([x, y], a, b) < r) return true;
    // neck + head
    if (Math.abs(x - headC[0]) < 0.02 * s && y > headC[1] && y < sMid[1]) return true;
    return ((x - headC[0]) / headR[0]) ** 2 + ((y - headC[1]) / headR[1]) ** 2 < 1;
  };
  const inside = (u: number, v: number): number => {
    // 3×3 supersampling for soft edges
    let n = 0;
    const dx = 0.33 / W;
    const dy = 0.33 / H;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (insideQ((u + i * dx) * A, v + j * dy)) n++;
    return n / 9;
  };

  const me = opts.maskEdge ?? 256;
  const mw = A >= 1 ? me : Math.round(me * A);
  const mh = A >= 1 ? Math.round(me / A) : me;
  const data = new Uint8Array(mw * mh);
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) data[y * mw + x] = Math.round(255 * inside((x + 0.5) / mw, (y + 0.5) / mh));

  const ext = new Float32Array(16);
  const top = z([0.5, 0.075]);
  const chin = z([0.5, 0.163]);
  ext.set([top[0], top[1], top[0], top[1] + 0.01, top[0], top[1] + 0.03, top[0], top[1] + 0.04, chin[0], chin[1], chin[0], chin[1] - 0.01, 0.46, 0.12, 0.54, 0.12]);
  const face: Face = { pts111: new Float32Array(222), ext, oval: new Float32Array(72), yaw: 0 };

  // background geometry: the silhouette edges at the waist (narrowest torso station), shoulder and hip rows
  let tw = 0.6;
  for (let t = 0.3; t <= 0.9; t += 0.001) if (torsoHalf(t) < torsoHalf(tw)) tw = t;
  const waistHalfU = torsoHalf(tw) / A;
  const geom: BgGeom = {
    waistL: sMid[0] / A - waistHalfU,
    waistR: sMid[0] / A + waistHalfU,
    waistHalfU,
    shoulderV: sMid[1],
    hipV: hMid[1],
  };
  const lineCache = new Map<BackgroundKind, BgLine[]>();
  const lines = (bg: BackgroundKind): BgLine[] => {
    let ls = lineCache.get(bg);
    if (!ls) lineCache.set(bg, (ls = backgroundLines(bg, geom, W, H)));
    return ls.map((l) => ({ a: [...l.a], b: [...l.b], tag: l.tag }));
  };

  const paint = (u: number, v: number, bg: BackgroundKind = 'room'): [number, number, number] => {
    const m = inside(u, v);
    if (!lineCache.has(bg)) lines(bg);
    const back = background(u, v, bg, W, H, lineCache.get(bg)!);
    if (m <= 0) return back;
    const x = u * A;
    let fg: [number, number, number];
    const rel = (v - sMid[1]) / torsoLen;
    if (((x - headC[0]) / headR[0]) ** 2 + ((v - headC[1]) / headR[1]) ** 2 < 1.05 || (v < sMid[1] && Math.abs(x - headC[0]) < 0.022 * s)) {
      fg = [224, 182, 150]; // skin
      if (v < headC[1] - 0.03 * s) fg = [60, 40, 30]; // hair
    } else if (rel < 1.0 && !(segDist([x, v], q(15), q(19)) < 0.017 * s || segDist([x, v], q(16), q(20)) < 0.017 * s)) {
      // shirt with horizontal stripes so width changes are easy to see
      fg = Math.floor(v * H / 14) % 2 ? [200, 60, 70] : [235, 235, 235];
    } else if (v > q(27)[1] - 0.005) {
      fg = [30, 30, 30]; // shoes
    } else if (rel >= 1.0) {
      fg = Math.floor(v * H / 20) % 2 ? [40, 70, 130] : [55, 90, 155]; // jeans
    } else fg = [224, 182, 150];
    return [fg[0] * m + back[0] * (1 - m), fg[1] * m + back[1] * (1 - m), fg[2] * m + back[2] * (1 - m)];
  };

  return { det: { pose: { points }, mask: { width: mw, height: mh, data }, people: 1, width: W, height: H }, face, inside, paint, lines, width: W, height: H };
}

interface BgGeom {
  /** the torso silhouette's left / right edge (u) at the waist row */
  waistL: number;
  waistR: number;
  /** the waist half-width W, in u */
  waistHalfU: number;
  shoulderV: number;
  hipV: number;
}

/** wall above the baseboard (v < 0.8) */
const WALL_BOTTOM = 0.8;
const LINE_RGB: readonly number[] = [40, 40, 48];
const WALL_RGB: readonly number[] = [225, 222, 230];

/** Every line of `kind` (UV); each is painted 2 px wide. */
function backgroundLines(kind: BackgroundKind, g: BgGeom, W: number, H: number): BgLine[] {
  const out: BgLine[] = [];
  if (kind === 'doorClose') {
    for (const k of [0.25, 0.5, 1, 2]) {
      const dl = g.waistL - k * g.waistHalfU;
      const dr = g.waistR + k * g.waistHalfU;
      out.push({ a: [dl, 0], b: [dl, WALL_BOTTOM], tag: `door+${k}W L` });
      out.push({ a: [dr, 0], b: [dr, WALL_BOTTOM], tag: `door+${k}W R` });
    }
  } else if (kind === 'tiles30') {
    // two perpendicular families at 30° and −60° (y down), 48 px apart, clipped to the frame
    for (const deg of [30, -60]) {
      const r = (deg * Math.PI) / 180;
      const d: V2 = [Math.cos(r), Math.sin(r)];
      const n: V2 = [-d[1], d[0]];
      const cs = [0, W * n[0], H * n[1], W * n[0] + H * n[1]];
      let i = 0;
      for (let c = Math.ceil(Math.min(...cs) / 48) * 48; c <= Math.max(...cs); c += 48) {
        const seg = clipLine([c * n[0], c * n[1]], d, W, H);
        if (seg) out.push({ a: [seg[0][0] / W, seg[0][1] / H], b: [seg[1][0] / W, seg[1][1] / H], tag: `tile${deg} #${i++}` });
      }
    }
  } else if (kind === 'blinds') {
    let i = 0;
    for (let y = 8; y < (g.shoulderV + 0.03) * H; y += 12) out.push({ a: [0, y / H], b: [1, y / H], tag: `blind #${i++}` });
  } else if (kind === 'brick') {
    const y0 = g.hipV * H;
    const y1 = WALL_BOTTOM * H;
    let i = 0;
    for (let y = y0; y <= y1; y += 20) out.push({ a: [0, y / H], b: [1, y / H], tag: `brick-h #${i++}` });
    let row = 0;
    for (let y = y0; y + 20 <= y1; y += 20, row++)
      for (let x = row % 2 ? 24 : 0; x <= W; x += 48) out.push({ a: [x / W, y / H], b: [x / W, (y + 20) / H], tag: `brick-v r${row} x${x}` });
  }
  return out;
}

/** The part of the line p + t·d inside [0, W] × [0, H] (longer than 1 px), or null. */
function clipLine(p: V2, d: V2, W: number, H: number): [V2, V2] | null {
  let t0 = -Infinity;
  let t1 = Infinity;
  for (const [o, dd, hi] of [
    [p[0], d[0], W],
    [p[1], d[1], H],
  ] as const) {
    if (Math.abs(dd) < 1e-12) {
      if (o < 0 || o > hi) return null;
      continue;
    }
    const a = -o / dd;
    const b = (hi - o) / dd;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  if (!(t1 - t0 > 1)) return null;
  return [
    [p[0] + t0 * d[0], p[1] + t0 * d[1]],
    [p[0] + t1 * d[0], p[1] + t1 * d[1]],
  ];
}

/** Coverage (0..1) of the 2 px wide lines at pixel (x, y): 1 within 1 px of a line, then a 1 px linear falloff. */
function lineCover(x: number, y: number, ls: readonly BgLine[], W: number, H: number): number {
  let cover = 0;
  for (const l of ls) {
    const d = segDist([x, y], [l.a[0] * W, l.a[1] * H], [l.b[0] * W, l.b[1] * H]);
    if (d < 2) cover = Math.max(cover, Math.min(1, 2 - d));
  }
  return cover;
}

function background(u: number, v: number, kind: BackgroundKind, W: number, H: number, ls: readonly BgLine[]): [number, number, number] {
  const x = u * W;
  const y = v * H;
  if (kind === 'doorClose' || kind === 'tiles30' || kind === 'blinds' || kind === 'brick') {
    const c = lineCover(x, y, ls, W, H);
    return [0, 1, 2].map((k) => WALL_RGB[k] * (1 - c) + LINE_RGB[k] * c) as [number, number, number];
  }
  if (kind === 'stripes') {
    const vs = Math.floor(x / 12) % 2 === 0;
    const hs = Math.floor(y / 12) % 2 === 0;
    return vs !== hs ? [30, 30, 30] : [240, 240, 240];
  }
  if (kind === 'checker') return (Math.floor(x / 24) + Math.floor(y / 24)) % 2 ? [90, 90, 90] : [200, 200, 200];
  // room: wall, two door-frame verticals, thin vertical pin-stripes, baseboard + tiled floor
  if (v > 0.83) {
    const tile = (Math.floor(x / 40) + Math.floor((y - 0.83 * H) / 20)) % 2;
    if (Math.abs(((x + 0.6 * (y - 0.83 * H)) % 40) - 20) < 1.2) return [70, 60, 50]; // diagonal tile seams
    return tile ? [150, 120, 90] : [170, 140, 110];
  }
  if (v > 0.8) return [50, 45, 40]; // baseboard
  for (const fx of [0.2, 0.8]) if (Math.abs(u - fx) * W < 6) return [120, 80, 50]; // door frames
  if (Math.abs((x % 30) - 15) < 0.8) return [190, 190, 200];
  if (Math.abs((y % 60) - 30) < 0.8) return [200, 195, 205];
  return [225, 222, 230];
}

// ───────────────────────── portrait for 瘦臉 (cheek against a wall) ─────────────────────────

export interface SyntheticPortrait {
  /** the GPUPixel face template placed in the frame (FW = contour point 0 → 32 = `faceWidth` of the width) */
  face: Face;
  /** person-ness at UV: the face oval (no hair, no ears), neck and shoulders; 3×3 supersampled */
  inside(u: number, v: number): number;
  /** skin / shirt over a plain wall carrying only `lines` */
  paint(u: number, v: number): [number, number, number];
  /**
   * The wall lines: verticals 0.02 / 0.05 / 0.1 / 0.2 / 0.4 FW outside the mid-cheek (contour points 7 / 25) on both
   * sides — the first two touch the temple, so they emerge from behind the face — plus horizontals at the mouth and
   * the jaw (contour 10) that run behind the face.
   */
  lines: BgLine[];
  width: number;
  height: number;
}

export function syntheticPortrait(opts: { width?: number; height?: number; faceWidth?: number } = {}): SyntheticPortrait {
  const W = opts.width ?? 600;
  const H = opts.height ?? 800;
  const tw = (i: number): V2 => [FACE_TEMPLATE[i * 2], FACE_TEMPLATE[i * 2 + 1]];
  const fwT = Math.hypot(tw(0)[0] - tw(32)[0], tw(0)[1] - tw(32)[1]);
  const k = ((opts.faceWidth ?? 0.5) * W) / fwT; // px per template unit
  const toUV = (t: V2): V2 => [0.5 + ((t[0] - 0.5) * k) / W, 0.4 + ((t[1] - 0.5) * k) / H];
  const pts111 = new Float32Array(222);
  for (let i = 0; i < 111; i++) pts111.set(toUV(tw(i)), i * 2);
  // oval (36 points like MediaPipe's): every other jaw contour point 0 → 32 (image-left temple, chin, image-right
  // temple), then 19 points of an elliptic forehead arc back over the top
  const c: V2 = [(tw(0)[0] + tw(32)[0]) / 2, (tw(0)[1] + tw(32)[1]) / 2];
  const ax = fwT / 2;
  const top = 0.17; // hairline height in the template (brows ≈ 0.33, chin 0.71)
  const oval = new Float32Array(72);
  for (let i = 0; i <= 16; i++) oval.set(pts111.subarray(i * 4, i * 4 + 2), i * 2);
  for (let j = 1; j <= 19; j++) {
    const r = (j * Math.PI) / 20;
    oval.set(toUV([c[0] + ax * Math.cos(r), c[1] - (c[1] - top) * Math.sin(r)]), (16 + j) * 2);
  }
  const ext = new Float32Array(16);
  [
    [0.5, top],
    [0.5, 0.25],
    [0.5, 0.33],
    [0.5, 0.36],
    [0.5, 0.71],
    [0.5, 0.68],
    [0.3, 0.45],
    [0.7, 0.45],
  ].forEach((t, i) => ext.set(toUV(t as unknown as V2), i * 2));
  const face: Face = { pts111, ext, oval, yaw: 0 };

  const ovalPx: V2[] = [];
  for (let i = 0; i < 36; i++) ovalPx.push([oval[i * 2] * W, oval[i * 2 + 1] * H]);
  const inPoly = (x: number, y: number) => {
    let inn = false;
    for (let i = 0, j = 35; i < 36; j = i++) {
      const [xi, yi] = ovalPx[i];
      const [xj, yj] = ovalPx[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inn = !inn;
    }
    return inn;
  };
  const fw = fwT * k;
  const cx = 0.5 * W;
  const chinY = pts111[16 * 2 + 1] * H;
  const shoulderY = chinY + 0.45 * fw;
  const ob = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of ovalPx) {
    ob[0] = Math.min(ob[0], x);
    ob[1] = Math.min(ob[1], y);
    ob[2] = Math.max(ob[2], x);
    ob[3] = Math.max(ob[3], y);
  }
  const insidePx = (x: number, y: number): boolean => {
    if (x >= ob[0] && y >= ob[1] && x <= ob[2] && y <= ob[3] && inPoly(x, y)) return true;
    if (y > chinY - 0.15 * fw && y < shoulderY + 0.1 * fw && Math.abs(x - cx) < 0.22 * fw) return true; // neck
    // shoulders: a wide ellipse whose top is shoulderY
    return y > shoulderY && ((x - cx) / (1.6 * fw)) ** 2 + ((y - (shoulderY + 0.9 * fw)) / (0.9 * fw)) ** 2 < 1;
  };
  const inside = (u: number, v: number): number => {
    let n = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (insidePx(u * W + i * 0.33, v * H + j * 0.33)) n++;
    return n / 9;
  };

  const lines: BgLine[] = [];
  for (const f of [0.02, 0.05, 0.1, 0.2, 0.4]) {
    const xl = pts111[7 * 2] - (f * fw) / W;
    const xr = pts111[25 * 2] + (f * fw) / W;
    lines.push({ a: [xl, 0], b: [xl, shoulderY / H - 0.01], tag: `wall+${f}FW L` });
    lines.push({ a: [xr, 0], b: [xr, shoulderY / H - 0.01], tag: `wall+${f}FW R` });
  }
  lines.push({ a: [0, pts111[106 * 2 + 1]], b: [1, pts111[106 * 2 + 1]], tag: 'wall-h mouth' });
  lines.push({ a: [0, pts111[10 * 2 + 1]], b: [1, pts111[10 * 2 + 1]], tag: 'wall-h jaw' });

  const paint = (u: number, v: number): [number, number, number] => {
    const m = inside(u, v);
    const cov = lineCover(u * W, v * H, lines, W, H);
    const back = [0, 1, 2].map((i) => WALL_RGB[i] * (1 - cov) + LINE_RGB[i] * cov);
    if (m <= 0) return back as [number, number, number];
    const fg = v * H > shoulderY ? [70, 90, 140] : [224, 182, 150];
    return [0, 1, 2].map((i) => fg[i] * m + back[i] * (1 - m)) as [number, number, number];
  };
  return { face, inside, paint, lines, width: W, height: H };
}
