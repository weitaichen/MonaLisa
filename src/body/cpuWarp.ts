// CPU reference of the engine's body sampling: out(uv) = src(uv + field(uv)), both lookups bilinear with
// clamp-to-edge, field sampled at pixel centres exactly like the reshape shader's texture(uBodyDisp, vUv).
// Used by tests and the B1 harness to check geometry without a GL context.
import type { BodyField } from '../types';

/** Bilinear field lookup at UV (clamped), returns UV displacement. */
export function fieldAt(f: BodyField, u: number, v: number): [number, number] {
  const { width: w, height: h, data } = f;
  const x = Math.max(0, Math.min(w - 1, u * w - 0.5));
  const y = Math.max(0, Math.min(h - 1, v * h - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const out: [number, number] = [0, 0];
  for (let c = 0; c < 2; c++) {
    const a = data[(y0 * w + x0) * 2 + c] * (1 - fx) + data[(y0 * w + x1) * 2 + c] * fx;
    const b = data[(y1 * w + x0) * 2 + c] * (1 - fx) + data[(y1 * w + x1) * 2 + c] * fx;
    out[c] = a * (1 - fy) + b * fy;
  }
  return out;
}

/** Warp an image with `channels` interleaved channels (1 = mask, 4 = RGBA). */
export function warpImage(src: ArrayLike<number>, w: number, h: number, channels: number, field: BodyField | null): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * channels);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const v = (y + 0.5) / h;
      const [du, dv] = field ? fieldAt(field, u, v) : [0, 0];
      const sx = Math.max(0, Math.min(w - 1, (u + du) * w - 0.5));
      const sy = Math.max(0, Math.min(h - 1, (v + dv) * h - 0.5));
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(w - 1, x0 + 1);
      const y1 = Math.min(h - 1, y0 + 1);
      const fx = sx - x0;
      const fy = sy - y0;
      for (let c = 0; c < channels; c++) {
        const a = src[(y0 * w + x0) * channels + c] * (1 - fx) + src[(y0 * w + x1) * channels + c] * fx;
        const b = src[(y1 * w + x0) * channels + c] * (1 - fx) + src[(y1 * w + x1) * channels + c] * fx;
        out[(y * w + x) * channels + c] = a * (1 - fy) + b * fy;
      }
    }
  }
  return out;
}
