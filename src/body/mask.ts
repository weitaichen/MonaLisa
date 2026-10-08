// Person-mask access for measurement (scanlines) and 背景保護 (dilated + feathered protect weight).
import type { PersonMask } from '../types';
import { smoothstep, type V2 } from './geom';

/** Bilinear person-confidence lookup in Q space (0..1, 0 outside the image). */
export class MaskSampler {
  private readonly sx: number;
  private readonly sy: number;
  /** Q-space length of one mask texel (scanline step is half of it) */
  readonly texel: number;

  constructor(
    readonly mask: PersonMask,
    aspect: number,
  ) {
    this.sx = mask.width / aspect;
    this.sy = mask.height;
    this.texel = Math.max(aspect / mask.width, 1 / mask.height);
  }

  at(qx: number, qy: number): number {
    const { width: w, height: h, data } = this.mask;
    const x = qx * this.sx - 0.5;
    const y = qy * this.sy - 0.5;
    if (x < -0.5 || y < -0.5 || x > w - 0.5 || y > h - 0.5) return 0;
    const x0 = Math.max(0, Math.min(w - 1, Math.floor(x)));
    const y0 = Math.max(0, Math.min(h - 1, Math.floor(y)));
    const x1 = Math.min(w - 1, x0 + 1);
    const y1 = Math.min(h - 1, y0 + 1);
    const fx = Math.max(0, Math.min(1, x - x0));
    const fy = Math.max(0, Math.min(1, y - y0));
    const a = data[y0 * w + x0] * (1 - fx) + data[y0 * w + x1] * fx;
    const b = data[y1 * w + x0] * (1 - fx) + data[y1 * w + x1] * fx;
    return (a * (1 - fy) + b * fy) / 255;
  }

  /**
   * March from p along unit direction d until the mask drops below 0.5 (the silhouette edge, sub-step accurate),
   * `stop(q, travelled)` fires, or `maxDist` is reached. Returns null when p itself is outside the person.
   */
  march(p: V2, d: V2, maxDist: number, stop?: (q: V2, t: number) => boolean): { dist: number; hit: 'edge' | 'stop' | 'max' } | null {
    let prev = this.at(p[0], p[1]);
    if (prev < 0.5) return null;
    const step = this.texel * 0.5;
    for (let t = step; t <= maxDist; t += step) {
      const q: V2 = [p[0] + d[0] * t, p[1] + d[1] * t];
      const v = this.at(q[0], q[1]);
      if (v < 0.5) return { dist: t - step * ((0.5 - v) / Math.max(prev - v, 1e-6)), hit: 'edge' };
      if (stop?.(q, t)) return { dist: t, hit: 'stop' };
      prev = v;
    }
    return { dist: maxDist, hit: 'max' };
  }
}

/**
 * From p (outside the person) march along d until the mask reaches 0.5 again: the width of the background gap to
 * the next person pixel (another body part), or maxDist when there is none within reach.
 */
export function gapAlong(s: MaskSampler, p: V2, d: V2, maxDist: number): number {
  const step = s.texel * 0.5;
  for (let t = step; t <= maxDist; t += step) if (s.at(p[0] + d[0] * t, p[1] + d[1] * t) >= 0.5) return t;
  return maxDist;
}

/** Exact 1-D squared distance transform (Felzenszwalb & Huttenlocher), in place over `f` with stride. */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Euclidean distance (in texels) from every texel to the nearest `inside` texel; 0 inside. */
export function distanceOutside(inside: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e12;
  const g = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = inside[i] ? 0 : INF;
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = g[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) g[y * w + x] = d[y];
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = g[y * w + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(d[x]);
  }
  return out;
}

/** Binary person mask (confidence ≥ 0.5) resampled onto a w×h grid of texel centres. */
export function maskOnGrid(s: MaskSampler, w: number, h: number, aspect: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const qy = (y + 0.5) / h;
    for (let x = 0; x < w; x++) out[y * w + x] = s.at(((x + 0.5) / w) * aspect, qy) >= 0.5 ? 1 : 0;
  }
  return out;
}

/**
 * 背景保護 weight on a w×h grid: 1 on the person dilated by `dilate`, falling to 0 over `feather` (Q units),
 * then box-blurred twice (3×3) so the medial-axis kinks of the distance field do not show in the warp.
 * |∇M| ≤ 1.5 / feather, which is what bounds the extra Jacobian term D·∇M (see field.ts).
 */
export function protectWeights(
  inside: Uint8Array,
  w: number,
  h: number,
  dilate: number,
  feather: number,
  /** distanceOutside(inside, w, h), when the caller already has it (field.ts caches it per measure) */
  d: Float32Array = distanceOutside(inside, w, h),
): Float32Array {
  const texel = 1 / h; // grid texels are square in Q space (fieldSize keeps the aspect)
  let m: Float32Array = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) m[i] = 1 - smoothstep(dilate, dilate + feather, d[i] * texel);
  for (let pass = 0; pass < 2; pass++) m = boxBlur3(m, w, h);
  // the blur must not eat into the person itself
  for (let i = 0; i < w * h; i++) if (inside[i]) m[i] = 1;
  return m;
}

/**
 * 3×3 box blur, the mean over the in-grid neighbours. The in-grid part of the 3×3 window is a rectangle
 * (nx columns × ny rows, nx depending on x only), so the mean separates exactly into a row pass and a column pass.
 */
function boxBlur3(src: Float32Array, w: number, h: number): Float32Array {
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const r = y * w;
    for (let x = 0; x < w; x++) {
      let s = src[r + x];
      let n = 1;
      if (x > 0) {
        s += src[r + x - 1];
        n++;
      }
      if (x + 1 < w) {
        s += src[r + x + 1];
        n++;
      }
      tmp[r + x] = s / n;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const up = y > 0;
    const down = y + 1 < h;
    const n = 1 + (up ? 1 : 0) + (down ? 1 : 0);
    const r = y * w;
    for (let x = 0; x < w; x++) {
      let s = tmp[r + x];
      if (up) s += tmp[r - w + x];
      if (down) s += tmp[r + w + x];
      out[r + x] = s / n;
    }
  }
  return out;
}

/** Bilinear lookup of a w×h scalar grid at UV (clamped to the edge texels). */
export function sampleGrid(g: Float32Array, w: number, h: number, u: number, v: number): number {
  const x = Math.max(0, Math.min(w - 1, u * w - 0.5));
  const y = Math.max(0, Math.min(h - 1, v * h - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const a = g[y0 * w + x0] * (1 - fx) + g[y0 * w + x1] * fx;
  const b = g[y1 * w + x0] * (1 - fx) + g[y1 * w + x1] * fx;
  return a * (1 - fy) + b * fy;
}
