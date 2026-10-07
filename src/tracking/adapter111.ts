// MediaPipe 478 → GPUPixel 111 + ext anchors + oval + yaw. RB §2.7 is normative.
//
// GPUPixel's "left" is IMAGE-left, and detection runs on unmirrored frames, so GPUPixel-left points
// come from MediaPipe's RIGHT_* (subject-right) indices.
import type { Face, Landmarks478 } from '../types';
import { FACE_OVAL } from './faceOval';

/** A MediaPipe vertex, or the midpoint of two. */
type Src = number | readonly [number, number];

// Contour 0–32 is resampled by arc length each frame (17 + 17 points sharing chin 16), because
// MediaPipe's jaw vertices are unevenly spaced and their spacing varies with the face.
const CONTOUR_LEFT: readonly Src[] = [[162, 127], 127, 234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152];
const CONTOUR_RIGHT: readonly Src[] = [152, 377, 400, 378, 379, 365, 397, 288, 361, 323, 454, 356, [356, 389]];
const CONTOUR_HALF = 17;

/** GPUPixel 33–105 in index order. */
const DIRECT: readonly Src[] = [
  // 33–37 brow upper, image-left, outer → inner; 38–42 image-right, inner → outer
  70, 63, 105, 66, 107, 336, 296, 334, 293, 300,
  // 43–46 nose bridge top → tip; 47–51 nose base, image-left → right (49 = subnasale)
  6, 195, 5, 1, 98, 97, 2, 326, 327,
  // 52–57 image-left eye: outer, upper ×2, inner, lower ×2
  33, 160, 157, 133, 154, 144,
  // 58–63 image-right eye: inner, upper ×2, outer, lower ×2
  362, 384, 387, 263, 373, 381,
  // 64–67 / 68–71 brow lower
  46, 52, 65, 55, 285, 295, 282, 276,
  // 72–74 image-left eye upper-mid / lower-mid / centre (not the iris: that is gaze-dependent)
  159, 145, [33, 133],
  // 75–77 image-right eye
  386, 374, [362, 263],
  // 78/79 bridge sides at canthus height, 80/81 nose wings, 82/83 outer alar base
  245, 465, 48, 278, 64, 294,
  // 84 / 90 mouth corners with 85–89 upper-lip top between them
  61, 39, 37, 0, 267, 269, 291,
  // 91–95 lower-lip bottom, right → left
  321, 314, 17, 84, 91,
  // 96 / 100 inner corners, 97–99 upper inner, 101–103 lower inner (right → left)
  78, 81, 13, 311, 308, 402, 14, 178,
  // 104 / 105 pupils
  468, 473,
];
const DIRECT_FIRST = 33;

/** Extension anchors in the fixed order of `Face.ext`. */
const EXT: readonly number[] = [10, 151, 9, 168, 152, 199, 234, 454];

const N_MP = 478;
const MAX_CHAIN = 13;
const sx = new Float64Array(MAX_CHAIN);
const sy = new Float64Array(MAX_CHAIN);
const cum = new Float64Array(MAX_CHAIN);

function srcX(p: Float32Array, s: Src): number {
  return typeof s === 'number' ? p[s * 3] : (p[s[0] * 3] + p[s[1] * 3]) * 0.5;
}
function srcY(p: Float32Array, s: Src): number {
  return typeof s === 'number' ? p[s * 3 + 1] : (p[s[0] * 3 + 1] + p[s[1] * 3 + 1]) * 0.5;
}

/**
 * Resample `chain` into CONTOUR_HALF points equally spaced by arc length, measured in pixels
 * (isotropic), endpoints included, written to out[first..first+16].
 */
function resampleChain(p: Float32Array, chain: readonly Src[], w: number, h: number, out: Float32Array, first: number) {
  const n = chain.length;
  cum[0] = 0;
  for (let i = 0; i < n; i++) {
    sx[i] = srcX(p, chain[i]) * w;
    sy[i] = srcY(p, chain[i]) * h;
    if (i > 0) cum[i] = cum[i - 1] + Math.hypot(sx[i] - sx[i - 1], sy[i] - sy[i - 1]);
  }
  const total = cum[n - 1];
  let seg = 0;
  for (let k = 0; k < CONTOUR_HALF; k++) {
    const target = (total * k) / (CONTOUR_HALF - 1);
    while (seg < n - 2 && cum[seg + 1] < target) seg++;
    const len = cum[seg + 1] - cum[seg];
    const t = len > 0 ? Math.min(1, Math.max(0, (target - cum[seg]) / len)) : 0;
    const o = (first + k) * 2;
    out[o] = (sx[seg] + (sx[seg + 1] - sx[seg]) * t) / w;
    out[o + 1] = (sy[seg] + (sy[seg + 1] - sy[seg]) * t) / h;
  }
}

function setMid(out: Float32Array, dst: number, a: number, b: number) {
  out[dst * 2] = (out[a * 2] + out[b * 2]) * 0.5;
  out[dst * 2 + 1] = (out[a * 2 + 1] + out[b * 2 + 1]) * 0.5;
}

/**
 * Yaw proxy (RB §2.4): (|p74−p46| − |p77−p46|) / (|p74−p46| + |p77−p46|), in pixels.
 * Positive when the image-left eye is farther from the nose tip than the image-right eye.
 */
export function yawProxy(pts111: Float32Array, width: number, height: number): number {
  const d = (i: number) =>
    Math.hypot((pts111[i * 2] - pts111[46 * 2]) * width, (pts111[i * 2 + 1] - pts111[46 * 2 + 1]) * height);
  const l = d(74);
  const r = d(77);
  const s = l + r;
  return s > 0 ? (l - r) / s : 0;
}

/** width/height = source pixel size (for isotropic arc-length resampling). */
export function adapt(l: Landmarks478, width: number, height: number): Face {
  const p = l.points;
  if (p.length < N_MP * 3) throw new Error(`adapt: expected ${N_MP * 3} values, got ${p.length}`);
  const w = width > 0 ? width : 1;
  const h = height > 0 ? height : 1;

  const pts111 = new Float32Array(222);
  resampleChain(p, CONTOUR_LEFT, w, h, pts111, 0);
  resampleChain(p, CONTOUR_RIGHT, w, h, pts111, CONTOUR_HALF - 1);
  for (let i = 0; i < DIRECT.length; i++) {
    const o = (DIRECT_FIRST + i) * 2;
    pts111[o] = srcX(p, DIRECT[i]);
    pts111[o + 1] = srcY(p, DIRECT[i]);
  }
  // 106–110 follow the template's own midpoint rules on adapted points (exact in the template).
  setMid(pts111, 106, 98, 102);
  setMid(pts111, 107, 35, 65);
  setMid(pts111, 108, 40, 70);
  setMid(pts111, 109, 5, 80);
  setMid(pts111, 110, 27, 81);

  const ext = new Float32Array(EXT.length * 2);
  for (let i = 0; i < EXT.length; i++) {
    ext[i * 2] = p[EXT[i] * 3];
    ext[i * 2 + 1] = p[EXT[i] * 3 + 1];
  }

  const oval = new Float32Array(FACE_OVAL.length * 2);
  for (let i = 0; i < FACE_OVAL.length; i++) {
    oval[i * 2] = p[FACE_OVAL[i] * 3];
    oval[i * 2 + 1] = p[FACE_OVAL[i] * 3 + 1];
  }

  return { pts111, ext, oval, yaw: yawProxy(pts111, w, h) };
}
