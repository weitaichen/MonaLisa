// The up frame U (C §3.5, S §3.4, §3.6): O turned by whole quarters only, so that U-up = E-up and E rows = U rows. Detectors
// that care which way is up (BlazeFace, the pose model, the selfie segmenter) and the body measure run in U; their
// results come back to O by exact permutations. Pure except upCanvas / upImage / upTracker's detectImage (DOM).
import type { BodyDetections, BodyField, Face, Landmarks478, PersonMask, Pose33, Tracker } from '../types';
import { apply, applyVec, quarterAffine, type Quarter } from './view';

export function inverseQuarter(q: Quarter): Quarter {
  return ((4 - q) % 4) as Quarter;
}

/** (x, y) pairs every `stride` floats (the rest, e.g. z or visibility, copied) mapped O → U */
export function pointsOToU(src: Float32Array, stride: number, q: Quarter): Float32Array {
  const out = new Float32Array(src);
  if (q === 0) return out;
  const m = quarterAffine(q);
  for (let i = 0; i + 1 < src.length; i += stride) {
    const [x, y] = apply(m, [src[i], src[i + 1]]);
    out[i] = x;
    out[i + 1] = y;
  }
  return out;
}

export function pointsUToO(src: Float32Array, stride: number, q: Quarter): Float32Array {
  return pointsOToU(src, stride, inverseQuarter(q));
}

/** 478 × (x, y, z) found on the U image → O; z unchanged (the yaw proxy uses isotropic x, y distances) */
export function landmarksUToO(points: Float32Array, q: Quarter): Float32Array {
  return q === 0 ? points : pointsUToO(points, 3, q);
}

export function poseOToU(p: Pose33, q: Quarter): Pose33 {
  return q === 0 ? p : { points: pointsOToU(p.points, 4, q) };
}

export function poseUToO(p: Pose33, q: Quarter): Pose33 {
  return q === 0 ? p : { points: pointsUToO(p.points, 4, q) };
}

/** the face in U, for the body measure's head / neck anchors (S §3.4) */
export function faceOToU(f: Face, q: Quarter): Face {
  if (q === 0) return f;
  return { ...f, pts111: pointsOToU(f.pts111, 2, q), ext: pointsOToU(f.ext, 2, q), oval: pointsOToU(f.oval, 2, q) };
}

/** grid permutation by q clockwise quarter turns (row 0 = top); channels interleaved */
function permute<T extends Float32Array | Uint8Array>(data: T, w: number, h: number, ch: number, q: Quarter, make: (n: number) => T): { data: T; width: number; height: number } {
  const W = q % 2 === 1 ? h : w;
  const H = q % 2 === 1 ? w : h;
  const out = make(W * H * ch);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      let x: number;
      let y: number;
      if (q === 0) {
        x = i;
        y = j;
      } else if (q === 1) {
        x = j;
        y = h - 1 - i;
      } else if (q === 2) {
        x = w - 1 - i;
        y = h - 1 - j;
      } else {
        x = w - 1 - j;
        y = i;
      }
      const s = (y * w + x) * ch;
      const d = (j * W + i) * ch;
      for (let c = 0; c < ch; c++) out[d + c] = data[s + c];
    }
  }
  return { data: out, width: W, height: H };
}

export function maskOToU(m: PersonMask, q: Quarter): PersonMask {
  if (q === 0) return m;
  const r = permute(m.data, m.width, m.height, 1, q, (n) => new Uint8Array(n));
  return { width: r.width, height: r.height, data: r.data };
}

export function maskUToO(m: PersonMask, q: Quarter): PersonMask {
  return maskOToU(m, inverseQuarter(q));
}

/** a backward field built on a U grid → the O grid: texels permuted, vectors turned by the U → O map's linear part */
export function fieldUToO(f: BodyField, q: Quarter): BodyField {
  if (q === 0) return f;
  const back = inverseQuarter(q);
  const r = permute(f.data, f.width, f.height, 2, back, (n) => new Float32Array(n));
  const m = quarterAffine(back);
  for (let i = 0; i < r.data.length; i += 2) {
    const [dx, dy] = applyVec(m, [r.data[i], r.data[i + 1]]);
    r.data[i] = dx;
    r.data[i + 1] = dy;
  }
  return { width: r.width, height: r.height, data: r.data, version: f.version };
}

/** body detection run on the U image → O (poses and masks; the reported size back to O's) */
export function bodiesUToO(d: BodyDetections, q: Quarter): BodyDetections {
  if (q === 0) return d;
  return {
    ...d,
    bodies: d.bodies.map((b) => ({ ...b, pose: poseUToO(b.pose, q), mask: b.mask ? maskUToO(b.mask, q) : null })),
    width: q % 2 === 1 ? d.height : d.width,
    height: q % 2 === 1 ? d.width : d.height,
  };
}

/** the U image as a canvas: an exact quarter-turn copy (smoothing off, about 12.6 MB at 2048), synchronous */
export function upCanvas(src: CanvasImageSource & { width: number; height: number }, q: Quarter): HTMLCanvasElement {
  const w = src.width;
  const h = src.height;
  const c = document.createElement('canvas');
  c.width = q % 2 === 1 ? h : w;
  c.height = q % 2 === 1 ? w : h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('upCanvas: 2D canvas unavailable');
  ctx.imageSmoothingEnabled = false;
  if (q === 1) ctx.setTransform(0, 1, -1, 0, h, 0);
  else if (q === 2) ctx.setTransform(-1, 0, 0, -1, w, h);
  else if (q === 3) ctx.setTransform(0, -1, 1, 0, 0, w);
  ctx.drawImage(src, 0, 0);
  return c;
}

/** the U image as an ImageBitmap (the canvas is released at once); q = 0 hands back the bitmap itself */
export async function upImage(bitmap: ImageBitmap, q: Quarter): Promise<{ image: ImageBitmap; close(): void }> {
  if (q === 0) return { image: bitmap, close: () => undefined };
  const c = upCanvas(bitmap, q);
  try {
    const image = await createImageBitmap(c);
    return { image, close: () => image.close() };
  } finally {
    c.width = c.height = 0;
  }
}

/** a Tracker whose IMAGE detection runs on the U image and answers in O (the one-time sideways scan, S §3.6) */
export function upTracker(t: Tracker, q: Quarter): Tracker {
  if (q === 0) return t;
  return {
    get delegate() {
      return t.delegate;
    },
    detectVideo: (video, ts, opts) => t.detectVideo(video, ts, opts),
    detectImage(image, opts) {
      const c = upCanvas(image as CanvasImageSource & { width: number; height: number }, q);
      try {
        return t.detectImage(c, opts).map((lm: Landmarks478) => ({ ...lm, points: landmarksUToO(lm.points, q) }));
      } finally {
        c.width = c.height = 0;
      }
    },
    close: () => t.close(),
  };
}
