// CPU reference of the 祛痘 heal P0b (skin-cleanup spec §4.5): the copy, the robust ring (8-bit, as the RING target
// stores it) and the Poisson-membrane spot quads with premultiplied blending into the 8-bit copy, in list order. Mirrors
// ./shaders/heal.ts (hash-pinned in healCpu.test.ts); tests/e2e/tone-engine.spec.ts compares the GPU with it.
import { HEAL_RING_SAMPLES } from '../config/limits';
import type { Spot } from '../types';
import { IDENTITY_WIN, smoothstep, TONE_ZERO, type Win } from './passes/toneGeometry';
import { LUMA709, q8, sample, type Img } from './toneCpu';

export interface SpotPx {
  c: [number, number];
  r: number;
  d: [number, number];
  fill: boolean;
}

/** a spot in the px of a src covering the O rectangle `win` */
export function spotPx(s: Spot, w: number, h: number, win: Win = IDENTITY_WIN): SpotPx {
  const ox = w / win[2];
  const oy = h / win[3];
  const short = Math.min(ox, oy);
  return { c: [(s.x - win[0]) * ox, (s.y - win[1]) * oy], r: s.r * short, d: [s.dx * short, s.dy * short], fill: s.dx === 0 && s.dy === 0 };
}

/** o_k: μ₀ and σ₀ from all samples; μ₁ and σ₁ weighted by those first weights; then the weights once more */
export function robustWeights(y: ArrayLike<number>): Float64Array {
  const n = y.length;
  let mu = 0;
  for (let k = 0; k < n; k++) mu += y[k];
  mu /= n;
  let v = 0;
  for (let k = 0; k < n; k++) v += (y[k] - mu) ** 2;
  const sig = Math.sqrt(v / n) + 0.01;
  const o0 = new Float64Array(n);
  let sw = 0;
  let swy = 0;
  for (let k = 0; k < n; k++) {
    o0[k] = 1 / (1 + ((y[k] - mu) / (2 * sig)) ** 2);
    sw += o0[k];
    swy += o0[k] * y[k];
  }
  const mu1 = swy / sw;
  let sv = 0;
  for (let k = 0; k < n; k++) sv += o0[k] * (y[k] - mu1) ** 2;
  const sig1 = Math.sqrt(sv / sw) + 0.01;
  const out = new Float64Array(n);
  for (let k = 0; k < n; k++) out[k] = 1 / (1 + ((y[k] - mu1) / (2 * sig1)) ** 2);
  return out;
}

const tmp = [0, 0, 0, 0];
function tap(src: Img, x: number, y: number, out: number[]): number[] {
  sample(src, x / src.w, y / src.h, tmp);
  out[0] = tmp[0];
  out[1] = tmp[1];
  out[2] = tmp[2];
  return out;
}
function ringMean(src: Img, c: readonly [number, number], ux: number, uy: number, r: number): [number, number, number] {
  const a = [0, 0, 0];
  const s: [number, number, number] = [0, 0, 0];
  for (const k of [1.2, 1.3, 1.4]) {
    tap(src, c[0] + k * r * ux, c[1] + k * r * uy, a);
    s[0] += a[0] / 3;
    s[1] += a[1] / 3;
    s[2] += a[2] / 3;
  }
  return s;
}

/** what the RING target stores for one spot: encoded values (ZERO + Δ_k, fill: T_k) and the weights, both 8-bit */
export function ringRow(src: Img, s: SpotPx, n = HEAL_RING_SAMPLES): { enc: Float64Array; w: Float64Array } {
  const dl = new Float64Array(n * 3);
  const y = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const th = (2 * Math.PI * k) / n;
    const ux = Math.cos(th);
    const uy = Math.sin(th);
    const T = ringMean(src, s.c, ux, uy, s.r);
    const D = s.fill ? [0, 0, 0] : ringMean(src, [s.c[0] + s.d[0], s.c[1] + s.d[1]], ux, uy, s.r);
    for (let c = 0; c < 3; c++) dl[k * 3 + c] = T[c] - D[c];
    y[k] = LUMA709[0] * dl[k * 3] + LUMA709[1] * dl[k * 3 + 1] + LUMA709[2] * dl[k * 3 + 2];
  }
  const o = robustWeights(y);
  const enc = new Float64Array(n * 3);
  const w = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    for (let c = 0; c < 3; c++) enc[k * 3 + c] = q8((s.fill ? 0 : TONE_ZERO) + dl[k * 3 + c]);
    w[k] = q8(o[k]);
  }
  return { enc, w };
}

/** M at (ρ′, φ): Σ o_k P_k Δ_k / Σ o_k P_k with the Poisson kernel P_k = (1 − ρ′²)/(1 − 2ρ′cos(φ − θ_k) + ρ′²) */
export function membrane(rp: number, phi: number, enc: ArrayLike<number>, w: ArrayLike<number>, fill: boolean, n = HEAL_RING_SAMPLES): [number, number, number] {
  const num: [number, number, number] = [0, 0, 0];
  let den = 0;
  const z = fill ? 0 : TONE_ZERO;
  for (let k = 0; k < n; k++) {
    const P = (1 - rp * rp) / (1 - 2 * rp * Math.cos(phi - (2 * Math.PI * k) / n) + rp * rp);
    const wk = w[k] * P;
    for (let c = 0; c < 3; c++) num[c] += wk * (enc[k * 3 + c] - z);
    den += wk;
  }
  const dd = Math.max(den, 1e-6);
  return [num[0] / dd, num[1] / dd, num[2] / dd];
}

/** P0b: the copy of `src` with every spot healed in list order (each quad reads the unhealed src) */
export function healCpu(src: Img, spots: readonly Spot[], win: Win = IDENTITY_WIN, n = HEAL_RING_SAMPLES): Img {
  const out: Img = { w: src.w, h: src.h, d: src.d.slice() };
  const donor = [0, 0, 0];
  for (const sp of spots) {
    const s = spotPx(sp, src.w, src.h, win);
    const { enc, w } = ringRow(src, s, n);
    const x0 = Math.max(0, Math.floor(s.c[0] - 1.1 * s.r));
    const x1 = Math.min(src.w - 1, Math.ceil(s.c[0] + 1.1 * s.r));
    const y0 = Math.max(0, Math.floor(s.c[1] - 1.1 * s.r));
    const y1 = Math.min(src.h - 1, Math.ceil(s.c[1] + 1.1 * s.r));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - s.c[0];
        const dy = y + 0.5 - s.c[1];
        const rr = Math.hypot(dx, dy);
        const rho = rr / s.r;
        if (rho > 1.1) continue;
        const M = membrane(rr / (1.3 * s.r), rr > 1e-6 ? Math.atan2(dy, dx) : 0, enc, w, s.fill, n);
        if (!s.fill) tap(src, x + 0.5 + s.d[0], y + 0.5 + s.d[1], donor);
        const a = 1 - smoothstep(0.8, 1.1, rho);
        const i = (y * src.w + x) * 4;
        for (let c = 0; c < 3; c++) {
          const healed = Math.min(1, Math.max(0, (s.fill ? 0 : donor[c]) + M[c]));
          out.d[i + c] = q8(healed * a + out.d[i + c] * (1 - a));
        }
      }
  }
  return out;
}
