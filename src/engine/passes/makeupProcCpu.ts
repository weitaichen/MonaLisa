// Test / harness-only CPU port of PMAKEUP_FS (makeupProc.ts): every kind's α and colour, the skin gate and the three
// fixed-function blend outputs, operation for operation. Never imported by the app. makeupProcCpu.test.ts pins
// PMAKEUP_FS's text; the e2e harness (tests/e2e/pages/makeup.ts) renders quads with affine attribute ramps through the
// real program and compares them with this port at every pixel centre (fwidth of an affine attribute is a constant).
import { smoothstep } from './eyeFrame';

export type RGB = [number, number, number];

export interface FragIn {
  kind: number;
  /** aLoc */
  loc: readonly [number, number];
  /** aAux */
  aux: readonly [number, number];
  /** tint RGB and α_max */
  col: readonly [number, number, number, number];
  /** src at the fragment, sRGB-encoded 0..1 */
  src: readonly [number, number, number];
  /** uLashes at (loc.x, 1 − loc.y), 0..1 */
  lash: number;
  /** fwidth(loc.y) and fwidth(18·loc.x) */
  fwD: number;
  fwU: number;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const fract = (x: number) => x - Math.floor(x);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const band = (y: number, a: number, b: number, f: number) => smoothstep(a - f, a + f, y) * (1 - smoothstep(b - f, b + f, y));

/** Rec. 709 luma of an sRGB-encoded colour */
export const luma = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** 修容 / 高光 occlusion gate (S5 §4.9): low luma floor (deep skin passes), chroma term rejects hair, frames, grey */
export function skinGate(r: number, g: number, b: number): number {
  return smoothstep(0.06, 0.14, luma(r, g, b)) * smoothstep(0.005, 0.04, r - b);
}

export function fragment(i: FragIn): { rgb: RGB; a: number } {
  const [u, d] = i.loc;
  const src = i.src;
  const skin = () => skinGate(src[0], src[1], src[2]);
  let rgb: RGB = [i.col[0], i.col[1], i.col[2]];
  let a = 0;
  switch (i.kind) {
    case 0: {
      const H = i.aux[0];
      const h = smoothstep(-0.22, 0.02, u) * (1 - smoothstep(0.8, 1.02, u)) * (0.55 + 0.45 * (1 - u));
      a = smoothstep(-0.02, 0.01, d) * (1 - smoothstep(0.3 * H, H, d)) * h;
      break;
    }
    case 1:
      a = 0.35 * band(d, 0, 0.07, 0.02) * smoothstep(-0.15, 0.05, u) * (1 - smoothstep(0.35, 0.55, u));
      break;
    case 2: {
      const T = i.aux[0];
      const f = Math.max(0.75 * i.fwD, 0.004);
      a = smoothstep(-0.006 - f, -0.006 + f, d) * (1 - smoothstep(T - f, T + f, d)) * (1 - smoothstep(0.85, 1, u));
      break;
    }
    case 3:
      a = i.lash;
      break;
    case 4:
    case 5: {
      const v = d / 0.12;
      const h = smoothstep(0.1, 0.35, u) * (1 - smoothstep(0.8, 0.95, u));
      a = i.kind === 4 ? 0.45 * h * smoothstep(0.05, 0.35, v) * (1 - smoothstep(0.55, 0.85, v)) : 0.35 * h * band(v, 0.86, 1, 0.06);
      break;
    }
    case 6:
    case 7: {
      const rho = Math.hypot(u, d);
      const mask = 1 - smoothstep(1.04, 1.1, rho);
      const lid = smoothstep(0, 0.05, i.aux[0]) * smoothstep(0, 0.04, i.aux[1]);
      const Y = luma(src[0], src[1], src[2]);
      const catchl = 1 - smoothstep(0.72, 0.88, Y);
      const ring = smoothstep(0.78, 0.92, rho);
      if (i.kind === 6) {
        const th = rho > 1e-6 ? Math.atan2(d, u) : 0;
        a = mask * lid * catchl * smoothstep(0.3, 0.38, rho);
        const k = (0.42 + 1.15 * Y) * (0.92 + 0.08 * Math.sin(28 * th)) * mix(1, 0.55, ring) * (0.85 + 0.15 * smoothstep(0, 0.1, i.aux[0]));
        rgb = [i.col[0] * k, i.col[1] * k, i.col[2] * k];
      } else {
        a = mask * lid * catchl * ring;
        rgb = [src[0] * 0.55, src[1] * 0.55, src[2] * 0.55];
      }
      break;
    }
    case 8: {
      const tilt = mix(0.15, 0.7, smoothstep(0.6, 1, u));
      const stripe = 1 - smoothstep(0.15, 0.35, Math.abs(fract(18 * u + tilt * 2.2 * d) - 0.5));
      const vis = 1 - smoothstep(0.25, 0.5, i.fwU);
      const strokes = mix(0.89, 0.78 + 0.22 * stripe, vis);
      a = smoothstep(0, 0.22, d) * (1 - smoothstep(0.78, 1, d)) * smoothstep(-0.12, 0.05, u) * mix(1, 0.45, smoothstep(0.7, 1, u)) * strokes;
      break;
    }
    case 9:
      a = 0.55 * skin() * smoothstep(0, 0.18, d) * (1 - smoothstep(0.35, 1, d)) * smoothstep(0, 0.12, u) * (1 - smoothstep(0.88, 1, u));
      break;
    case 10:
      a = 0.45 * skin() * (1 - smoothstep(0.35, 1, u * u + d * d));
      break;
    case 11:
      a = 0.3 * skin() * (1 - smoothstep(0.3, 1, Math.abs(2 * d - 1))) * smoothstep(0, 0.15, u) * (1 - smoothstep(0.75, 1, u));
      break;
    case 12: {
      const q = Math.abs(2 * d - 1);
      a = 0.35 * skin() * (1 - smoothstep(0.2, 1, q * q));
      break;
    }
    case 13:
      a = i.aux[0] * skin() * (1 - smoothstep(0.2, 1, u * u + d * d));
      break;
  }
  return { rgb, a: clamp01(a * i.col[3]) };
}

/**
 * The fixed-function result on an RGBA8 target: the fragment output is clamped to [0, 1] first (fixed-point buffer),
 * then multiply = dst·out (DST_COLOR, ZERO), screen = out + dst·(1 − out) (ONE, ONE_MINUS_SRC_COLOR),
 * over = out·α + dst·(1 − α) (SRC_ALPHA, ONE_MINUS_SRC_ALPHA).
 */
export function blend(mode: 0 | 1 | 2, dst: readonly [number, number, number], f: { rgb: RGB; a: number }): RGB {
  const out = (k: number) => clamp01(mode === 0 ? mix(1, f.rgb[k], f.a) : mode === 1 ? f.rgb[k] * f.a : f.rgb[k]);
  const one = (k: number) => {
    const o = out(k);
    if (mode === 0) return clamp01(dst[k] * o);
    if (mode === 1) return clamp01(o + dst[k] * (1 - o));
    return clamp01(o * f.a + dst[k] * (1 - f.a));
  };
  return [one(0), one(1), one(2)];
}
