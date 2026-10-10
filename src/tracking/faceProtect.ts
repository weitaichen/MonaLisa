// 瘦臉 background limit (reports/美體修圖 背景扭曲 抑制技術.md, stage 1 ②): the signed distance from every point of the
// photo to the person, which the reshape shader turns into a displacement budget for the face CONTOUR warps (瘦臉 /
// V臉 / 窄臉 / 下巴 / 額頭): full effect on the person, then a budget that falls smoothly to 0 a short way outside it,
// so the wall next to a cheek no longer swims. The eye / nose / mouth warps are never limited (see reshape.ts).
//
// The person = the person mask (美體's PoseLandmarker PersonMask when a detection is cached, else the on-demand
// selfie segmenter) ∪ the face oval, so a mask that misses part of the face never limits the face itself, restricted to
// the part connected to the face (another person or a stray false positive must not carry the face's warp). The
// distance is 1-Lipschitz (exact EDT, then box blurs that round the medial-axis kinks and the mask's stair steps, which
// would otherwise show as creases in the wall lines), which is what bounds the budget's slope and so the Jacobian of
// the limited warp (reshape.ts PROTECT_SLOPE).
import { distanceOutside } from '../body/mask';
import type { Face, FaceProtect, PersonMask } from '../types';

/** long edge of the distance grid (same order as the 美體 field and PersonMask) */
export const PROTECT_LONG_EDGE = 256;
/** the distance is smoothed over about this many face widths (box radius of three passes) */
export const SMOOTH_FW = 0.06;
/** the stored distance is clamped to ±SD_CLAMP iso units (fractions of the image width): far beyond any budget */
export const SD_CLAMP = 1;


/** Grid size for a `width`×`height` photo: long edge PROTECT_LONG_EDGE, aspect kept (≥ 1 texel). */
export function protectGridSize(width: number, height: number): [number, number] {
  const s = PROTECT_LONG_EDGE / Math.max(width, height, 1);
  return [Math.max(1, Math.round(width * s)), Math.max(1, Math.round(height * s))];
}

function inPolygon(poly: ArrayLike<number>, n: number, x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2];
    const yi = poly[i * 2 + 1];
    const xj = poly[j * 2];
    const yj = poly[j * 2 + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Bilinear person confidence (0..1) of `m` at UV, 0 outside the image. */
function maskAt(m: PersonMask, u: number, v: number): number {
  const x = u * m.width - 0.5;
  const y = v * m.height - 0.5;
  if (x < -0.5 || y < -0.5 || x > m.width - 0.5 || y > m.height - 0.5) return 0;
  const x0 = Math.max(0, Math.min(m.width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(m.height - 1, Math.floor(y)));
  const x1 = Math.min(m.width - 1, x0 + 1);
  const y1 = Math.min(m.height - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, x - x0));
  const fy = Math.max(0, Math.min(1, y - y0));
  const d = m.data;
  const a = d[y0 * m.width + x0] * (1 - fx) + d[y0 * m.width + x1] * fx;
  const b = d[y1 * m.width + x0] * (1 - fx) + d[y1 * m.width + x1] * fx;
  return (a * (1 - fy) + b * fy) / 255;
}

/** Box blur of radius r along rows then columns (the mean over the in-grid part of the window), in place. */
function boxBlur(a: Float32Array, w: number, h: number, r: number): void {
  const line = new Float32Array(Math.max(w, h));
  const pass = (n: number, count: number, at: (k: number, i: number) => number) => {
    for (let k = 0; k < count; k++) {
      for (let i = 0; i < n; i++) line[i] = a[at(k, i)];
      let s = 0;
      for (let i = 0; i <= Math.min(n - 1, r); i++) s += line[i];
      for (let i = 0; i < n; i++) {
        const lo = Math.max(0, i - r);
        const hi = Math.min(n - 1, i + r);
        a[at(k, i)] = s / (hi - lo + 1);
        if (i + r + 1 < n) s += line[i + r + 1];
        if (i - r >= 0) s -= line[i - r];
      }
    }
  };
  pass(w, h, (y, x) => y * w + x);
  pass(h, w, (x, y) => y * w + x);
}

/** Keep the person texels 4-connected to a seed texel (the face oval); everything else becomes background. */
function keepConnected(inside: Uint8Array, seed: Uint8Array, w: number, h: number): void {
  const keep = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++)
    if (seed[i] && inside[i]) {
      keep[i] = 1;
      stack.push(i);
    }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
      if (j < 0 || j >= w * h || keep[j] || !inside[j]) continue;
      keep[j] = 1;
      stack.push(j);
    }
  }
  inside.set(keep);
}

let versions = 0;

/**
 * The distance grid for `face` on a `width`×`height` photo: per texel the signed distance (iso units: fractions of the
 * image width) from the texel centre to the person, negative inside, clamped to ±SD_CLAMP. `mask` null → the face oval
 * alone is the person (then the hair counts as background and is limited too).
 */
export function buildFaceProtect(face: Face, mask: PersonMask | null, width: number, height: number): FaceProtect {
  const [w, h] = protectGridSize(width, height);
  const inside = new Uint8Array(w * h);
  const inOval = new Uint8Array(w * h);
  const oval = face.oval;
  const nOval = oval.length / 2;
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const i = y * w + x;
      inOval[i] = inPolygon(oval, nOval, u, v) ? 1 : 0;
      inside[i] = inOval[i] || (mask !== null && maskAt(mask, u, v) >= 0.5) ? 1 : 0;
    }
  }
  // only this face's person: another person, or a false positive of the segmenter, must not carry the face's warp
  keepConnected(inside, inOval, w, h);
  const outside = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) outside[i] = 1 - inside[i];
  const dOut = distanceOutside(inside, w, h); // texels to the nearest person texel (0 inside)
  const dIn = distanceOutside(outside, w, h); // texels to the nearest background texel (0 outside)
  const texel = 1 / w; // iso length of one texel (the grid keeps the aspect, so texels are square)
  const sd = new Float32Array(w * h);
  const anyIn = inside.some((b) => b === 1);
  const anyOut = outside.some((b) => b === 1);
  for (let i = 0; i < w * h; i++) {
    // the boundary lies half a texel from the centres on either side of it
    if (!anyOut) sd[i] = -SD_CLAMP; // nothing but person: nothing to protect
    else if (!anyIn) sd[i] = SD_CLAMP;
    else sd[i] = (inside[i] ? -(dIn[i] - 0.5) : dOut[i] - 0.5) * texel;
  }
  // smooth the medial-axis kinks and the mask's stair steps over ≈ SMOOTH_FW face widths (3 box passes ≈ a Gaussian)
  const P = face.pts111;
  const fwTexels = Math.hypot(P[0] - P[64], ((P[1] - P[65]) * height) / Math.max(1, width)) * w;
  const r = Math.max(1, Math.round(SMOOTH_FW * fwTexels));
  for (let k = 0; k < 3; k++) boxBlur(sd, w, h, r);
  for (let i = 0; i < w * h; i++) sd[i] = Math.max(-SD_CLAMP, Math.min(SD_CLAMP, sd[i]));
  return { width: w, height: h, data: sd, version: ++versions };
}
