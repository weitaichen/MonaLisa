// CPU reference of the 膚質 tone field P0c and retouch P0d (skin-cleanup spec §4.3–4.4): the stages of the shaders in
// ./shaders/tone.ts, with the 8-bit rounding every RGBA8 target applies after each stage. Pure, no GL. toneCpu.test.ts pins
// the shader text by hash; tests/e2e/tone-engine.spec.ts compares the GPU with this port.
// Y in the field is Rec. 709 luma; the retouch (白牙, 亮眼) works in JPEG full-range YCbCr (S §4.4).
import { IDENTITY_WIN, NO_MOUTHS, smoothstep, TONE_ZERO, type MouthGuards, type Win } from './passes/toneGeometry';
import { gaussWeights, lFactor, MAX_MOUTHS, sigmaMid, TONE } from './shaders/tone';

/** RGBA, 0..1, row 0 = image top */
export interface Img {
  w: number;
  h: number;
  d: Float32Array;
}

export const LUMA709: readonly [number, number, number] = [0.2126, 0.7152, 0.0722];

export const q8 = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 255) / 255;

export function makeImg(w: number, h: number, fill?: readonly number[]): Img {
  const d = new Float32Array(w * h * 4);
  if (fill) for (let i = 0; i < w * h; i++) d.set(fill, i * 4);
  return { w, h, d };
}

export function fromRgba8(w: number, h: number, data: ArrayLike<number>): Img {
  const o = makeImg(w, h);
  for (let i = 0; i < w * h * 4; i++) o.d[i] = data[i] / 255;
  return o;
}

export function toRgba8(a: Img): Uint8ClampedArray {
  const o = new Uint8ClampedArray(a.w * a.h * 4);
  for (let i = 0; i < o.length; i++) o[i] = Math.round(Math.min(1, Math.max(0, a.d[i])) * 255);
  return o;
}

function quantize(a: Img): Img {
  for (let i = 0; i < a.d.length; i++) a.d[i] = q8(a.d[i]);
  return a;
}

/** texelFetch with the coordinate clamped into the image */
export function texel(a: Img, x: number, y: number, out: number[]): number[] {
  const i = (Math.min(a.h - 1, Math.max(0, y)) * a.w + Math.min(a.w - 1, Math.max(0, x))) * 4;
  out[0] = a.d[i];
  out[1] = a.d[i + 1];
  out[2] = a.d[i + 2];
  out[3] = a.d[i + 3];
  return out;
}

/** texture() with LINEAR filtering and CLAMP_TO_EDGE at (u, v) */
export function sample(a: Img, u: number, v: number, out: number[]): number[] {
  const x = u * a.w - 0.5;
  const y = v * a.h - 0.5;
  const fx0 = Math.floor(x);
  const fy0 = Math.floor(y);
  const fx = x - fx0;
  const fy = y - fy0;
  const x0 = Math.min(a.w - 1, Math.max(0, fx0));
  const x1 = Math.min(a.w - 1, Math.max(0, fx0 + 1));
  const y0 = Math.min(a.h - 1, Math.max(0, fy0));
  const y1 = Math.min(a.h - 1, Math.max(0, fy0 + 1));
  const i00 = (y0 * a.w + x0) * 4;
  const i10 = (y0 * a.w + x1) * 4;
  const i01 = (y1 * a.w + x0) * 4;
  const i11 = (y1 * a.w + x1) * 4;
  for (let c = 0; c < 4; c++) {
    out[c] = (a.d[i00 + c] * (1 - fx) + a.d[i10 + c] * fx) * (1 - fy) + (a.d[i01 + c] * (1 - fx) + a.d[i11 + c] * fx) * fy;
  }
  return out;
}

export function toYcc(r: number, g: number, b: number): [number, number, number] {
  return [0.299 * r + 0.587 * g + 0.114 * b, 0.5 - 0.168736 * r - 0.331264 * g + 0.5 * b, 0.5 + 0.5 * r - 0.418688 * g - 0.081312 * b];
}
export function fromYcc(y: number, cb: number, cr: number): [number, number, number] {
  return [y + 1.402 * (cr - 0.5), y - 0.344136 * (cb - 0.5) - 0.714136 * (cr - 0.5), y + 1.772 * (cb - 0.5)];
}

const box = (x: number, lo: number, hi: number, e: number) => smoothstep(lo - e, lo, x) * (1 - smoothstep(hi, hi + e, x));
/** skin(c): soft box on Cb and Cr; keeps 膚色 off hair, clothes and background inside the wide ring */
export function skinGate(r: number, g: number, b: number): number {
  const [, cb, cr] = toYcc(r, g, b);
  return box(cb, TONE.skinCb[0], TONE.skinCb[1], TONE.skinSoft) * box(cr, TONE.skinCr[0], TONE.skinCr[1], TONE.skinSoft);
}

/** D8: the 8 × 8 box mean (the GPU takes 16 bilinear taps, each the mean of a 2 × 2 block) */
export function down8(base: Img): Img {
  const o = makeImg(Math.ceil(base.w / 8), Math.ceil(base.h / 8));
  const t = [0, 0, 0, 0];
  for (let j = 0; j < o.h; j++)
    for (let i = 0; i < o.w; i++) {
      const s = [0, 0, 0, 0];
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) {
          texel(base, i * 8 + x, j * 8 + y, t);
          for (let c = 0; c < 4; c++) s[c] += t[c];
        }
      for (let c = 0; c < 4; c++) o.d[(j * o.w + i) * 4 + c] = s[c] / 64;
    }
  return quantize(o);
}

/** one pass of the separable Gaussian, direct texel taps, edges clamped */
export function blurAxis(a: Img, w: Float32Array, axis: 'h' | 'v'): Img {
  const o = makeImg(a.w, a.h);
  const t = [0, 0, 0, 0];
  const u = [0, 0, 0, 0];
  for (let y = 0; y < a.h; y++)
    for (let x = 0; x < a.w; x++) {
      texel(a, x, y, t);
      const s = [w[0] * t[0], w[0] * t[1], w[0] * t[2], w[0] * t[3]];
      for (let k = 1; k < w.length; k++) {
        if (axis === 'h') {
          texel(a, x + k, y, t);
          texel(a, x - k, y, u);
        } else {
          texel(a, x, y + k, t);
          texel(a, x, y - k, u);
        }
        for (let c = 0; c < 4; c++) s[c] += w[k] * (t[c] + u[c]);
      }
      o.d.set(s, (y * a.w + x) * 4);
    }
  return quantize(o);
}

/** L's first stage: the (fL/8)² box of (Mn8 · q, q), q = Q.G sampled at each Mn8 texel centre (a normalized convolution) */
export function lBox(mn8: Img, q: Img, fL: 16 | 32): Img {
  const k = fL / 8;
  const o = makeImg(Math.ceil(mn8.w / k), Math.ceil(mn8.h / k));
  const t = [0, 0, 0, 0];
  const qv = [0, 0, 0, 0];
  for (let j = 0; j < o.h; j++)
    for (let i = 0; i < o.w; i++) {
      const s = [0, 0, 0, 0];
      for (let jj = 0; jj < k; jj++)
        for (let ii = 0; ii < k; ii++) {
          const tx = Math.min(mn8.w - 1, i * k + ii);
          const ty = Math.min(mn8.h - 1, j * k + jj);
          texel(mn8, tx, ty, t);
          sample(q, (tx + 0.5) / mn8.w, (ty + 0.5) / mn8.h, qv);
          const g = qv[1];
          s[0] += t[0] * g;
          s[1] += t[1] * g;
          s[2] += t[2] * g;
          s[3] += g;
        }
      for (let c = 0; c < 4; c++) o.d[(j * o.w + i) * 4 + c] = s[c] / (k * k);
    }
  return quantize(o);
}

/** the mid band b = Mn8 − L_c, split into luma bY and chroma bC, and the reference's confidence */
export function bandOf(m: ArrayLike<number>, L: ArrayLike<number>): { conf: number; bY: number; bC: [number, number, number] } {
  const a = Math.max(L[3], 1 / 255);
  const b0 = m[0] - L[0] / a;
  const b1 = m[1] - L[1] / a;
  const b2 = m[2] - L[2] / a;
  const bY = LUMA709[0] * b0 + LUMA709[1] * b1 + LUMA709[2] * b2;
  return { conf: smoothstep(TONE.conf[0], TONE.conf[1], L[3]), bY, bC: [b0 - bY, b1 - bY, b2 - bY] };
}

/** Δ of one ⅛ texel, unencoded (S §4.3) */
export function deltaTexel(m: ArrayLike<number>, L: ArrayLike<number>, q: ArrayLike<number>, r: ArrayLike<number>, out: number[]): number[] {
  const { conf, bY, bC } = bandOf(m, L);
  const lift = -Math.min(bY, 0);
  const gE = 1 - smoothstep(TONE.evenGuard[0], TONE.evenGuard[1], Math.abs(bY));
  const gD = 1 - smoothstep(TONE.darkGuard[0], TONE.darkGuard[1], -bY);
  const kE = q[0] * conf * gE;
  const kD = r[0] * conf * gD;
  const kN = r[1] * conf * gD;
  // 勻膚's chroma factor is capped at 1: at full weight it cancels bC, never inverts it
  const cE = Math.min(1, TONE.even.chroma * kE);
  for (let c = 0; c < 3; c++) {
    out[c] =
      -cE * bC[c] +
      TONE.even.lift * kE * lift +
      kD * (TONE.darkCircle.lift * lift - TONE.darkCircle.chroma * bC[c]) +
      kN * (TONE.nasolabial.lift * lift - TONE.nasolabial.chroma * bC[c]);
  }
  const s = Math.min(1, Math.max(-1, 2 * (q[2] - TONE_ZERO)));
  if (Math.abs(s) > 0.5 / 255) {
    const c0 = [m[0] + out[0], m[1] + out[1], m[2] + out[2]];
    const k = s >= 0 ? TONE.warm : TONE.cool;
    const a = Math.abs(s);
    const c1 = [c0[0] * (1 + a * k[0]), c0[1] * (1 + a * k[1]), c0[2] * (1 + a * k[2])];
    const y0 = LUMA709[0] * c0[0] + LUMA709[1] * c0[1] + LUMA709[2] * c0[2];
    const y1 = LUMA709[0] * c1[0] + LUMA709[1] * c1[1] + LUMA709[2] * c1[2];
    const keep = y0 / Math.max(y1, 1e-4);
    const sg = skinGate(c0[0], c0[1], c0[2]);
    for (let c = 0; c < 3; c++) out[c] += (c1[c] * keep - c0[c]) * sg;
  }
  return out;
}

/** Δ8: TONE_ZERO + 2·clamp(Δ, ±deltaMax) per ⅛ texel, from Mn8 (texel), L, Q and R (bilinear at the texel centre) */
export function deltaField(mn8: Img, l: Img, q: Img, r: Img): Img {
  const o = makeImg(mn8.w, mn8.h);
  const m = [0, 0, 0, 0];
  const L = [0, 0, 0, 0];
  const qv = [0, 0, 0, 0];
  const rv = [0, 0, 0, 0];
  const d = [0, 0, 0];
  for (let j = 0; j < mn8.h; j++)
    for (let i = 0; i < mn8.w; i++) {
      const u = (i + 0.5) / mn8.w;
      const v = (j + 0.5) / mn8.h;
      texel(mn8, i, j, m);
      sample(l, u, v, L);
      sample(q, u, v, qv);
      sample(r, u, v, rv);
      deltaTexel(m, L, qv, rv, d);
      const k = (j * mn8.w + i) * 4;
      for (let c = 0; c < 3; c++) o.d[k + c] = TONE_ZERO + 2 * Math.min(TONE.deltaMax, Math.max(-TONE.deltaMax, d[c]));
      o.d[k + 3] = 1;
    }
  return quantize(o);
}

export interface ToneFieldCpu {
  mn8: Img;
  l: Img | null;
  delta8: Img | null;
}

/** P0c from `base0` at working resolution; `fieldOn` false (亮眼 only) stops after Mn8 */
export function toneFieldCpu(base0: Img, q: Img, r: Img, sigmaLowPx: number, fieldOn: boolean): ToneFieldCpu {
  const wm = gaussWeights(sigmaMid(Math.min(base0.w, base0.h)) / 8);
  const mn8 = blurAxis(blurAxis(down8(base0), wm, 'h'), wm, 'v');
  if (!fieldOn) return { mn8, l: null, delta8: null };
  const fL = lFactor(sigmaLowPx);
  const wl = gaussWeights(sigmaLowPx / fL);
  const l = blurAxis(blurAxis(lBox(mn8, q, fL), wl, 'h'), wl, 'v');
  return { mn8, l, delta8: deltaField(mn8, l, q, r) };
}

/** 白牙 then 亮眼 on one pixel (S §4.4): `c` = base0 + Δ (in/out), `b0` = base0, `mn` = Mn8 at the pixel */
export function retouchPixel(c: number[], b0: ArrayLike<number>, mn: ArrayLike<number>, rB: number, rA: number): number[] {
  if (rB > 0) {
    let [y, cb, cr] = toYcc(c[0], c[1], c[2]);
    const t = smoothstep(TONE.teeth.y[0], TONE.teeth.y[1], y) * (1 - smoothstep(TONE.teeth.cr[0], TONE.teeth.cr[1], cr));
    const k = rB * t;
    cb += Math.max(0, 0.5 - cb) * TONE.teeth.cb * k;
    cr += (0.5 - cr) * TONE.teeth.crPull * k;
    y += TONE.teeth.lift * k * (1 - y);
    [c[0], c[1], c[2]] = fromYcc(y, cb, cr);
  }
  if (rA > 0) {
    const E = TONE.eye;
    let [y, cb, cr] = toYcc(c[0], c[1], c[2]);
    const ch = 2 * Math.hypot(cb - 0.5, cr - 0.5);
    const sc = smoothstep(E.scY[0], E.scY[1], y) * (1 - smoothstep(E.scCh[0], E.scCh[1], ch));
    // capped at 1: a fully weighted sclera lands on neutral, never past it
    const kd = Math.min(1, E.detint * rA * sc);
    cb += (0.5 - cb) * kd;
    cr += (0.5 - cr) * kd;
    y += E.scLift * rA * sc * (1 - y);
    const ir = smoothstep(E.irCh[0], E.irCh[1], ch) * smoothstep(E.irY0[0], E.irY0[1], y) * (1 - smoothstep(E.irY1[0], E.irY1[1], y));
    y += E.irLift * rA * ir;
    [c[0], c[1], c[2]] = fromYcc(y, cb, cr);
    for (let k = 0; k < 3; k++) c[k] += E.clarity * rA * (1 - sc) * Math.min(E.clamp, Math.max(-E.clamp, b0[k] - mn[k]));
  }
  for (let k = 0; k < 3; k++) c[k] = Math.min(1, Math.max(0, c[k]));
  return c;
}

/**
 * 白牙's lip guard at the O uv (ou, ov) (S §4.4): 0 outside every inner-lip polygon; inside one, smoothstep(0,
 * TONE.teeth.inset·mouthW, d) with d the true iso distance to its edge; the largest over the faces (at most MAX_MOUTHS)
 */
export function lipGuard(ou: number, ov: number, g: MouthGuards): number {
  const px = ou;
  const py = ov / g.aspect;
  let best = 0;
  for (const m of g.mouths.slice(0, MAX_MOUTHS)) {
    const ring = m.ring;
    let inside = false;
    let d = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      if (a[1] > py !== b[1] > py && px < ((b[0] - a[0]) * (py - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
      const abx = b[0] - a[0];
      const aby = b[1] - a[1];
      const t = Math.min(1, Math.max(0, ((px - a[0]) * abx + (py - a[1]) * aby) / Math.max(abx * abx + aby * aby, 1e-12)));
      d = Math.min(d, Math.hypot(px - a[0] - t * abx, py - a[1] - t * aby));
    }
    if (inside) best = Math.max(best, smoothstep(0, TONE.teeth.inset * m.mouthW, d));
  }
  return best;
}

/**
 * P0d at full resolution; `base0` covers the O rectangle `win` (a tile), Δ8 and Mn8 cover the whole O. 白牙 acts only
 * where `mouths` lets it (lipGuard); with none listed it does nothing.
 */
export function retouchCpu(base0: Img, field: ToneFieldCpu | null, r: Img, fieldOn: boolean, win: Win = IDENTITY_WIN, mouths: MouthGuards = NO_MOUTHS): Img {
  const out = makeImg(base0.w, base0.h);
  const b0 = [0, 0, 0, 0];
  const dl = [0, 0, 0, 0];
  const mn = [0, 0, 0, 0];
  const rv = [0, 0, 0, 0];
  for (let y = 0; y < base0.h; y++)
    for (let x = 0; x < base0.w; x++) {
      const u = (x + 0.5) / base0.w;
      const v = (y + 0.5) / base0.h;
      const ou = win[0] + u * win[2];
      const ov = win[1] + v * win[3];
      texel(base0, x, y, b0);
      const c = [b0[0], b0[1], b0[2]];
      if (fieldOn && field?.delta8) {
        sample(field.delta8, ou, ov, dl);
        for (let k = 0; k < 3; k++) c[k] += (dl[k] - TONE_ZERO) * 0.5;
      }
      sample(r, u, v, rv);
      if (rv[3] > 0 && field) sample(field.mn8, ou, ov, mn);
      const kB = rv[2] > 0 ? rv[2] * lipGuard(ou, ov, mouths) : 0;
      retouchPixel(c, b0, rv[3] > 0 && field ? mn : b0, kB, rv[3]);
      out.d.set([c[0], c[1], c[2], 1], (y * base0.w + x) * 4);
    }
  return quantize(out);
}
