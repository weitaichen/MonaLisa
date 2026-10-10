// Test / harness-only (never imported by the app, so it stays out of the bundle): how straight the background stays
// under a backward warp — the stage-0 yardstick of reports/美體修圖 背景扭曲 抑制技術.md (§四階段路線). The field is
// known, so no line detector is needed: dense virtual straight lines are forward-mapped through the warp and scored
// by their total-least-squares residual (a pure shift or rotation scores 0), and the local background magnification
// is 1/σ_min(J) − 1 of the backward map's Jacobian. Every px value is quoted at a 4032 px long edge (12 MP iPhone).
// Used by straightness.test.ts (the ratchet) and the B1 harness; same algorithms as the research scratch (exp.ts),
// so its numbers reproduce the report's tables.
import type { BodyField, Face, PersonMask } from '../types';
import { fieldMinJacobian } from './field';
import { distanceOutside } from './mask';

/** long edge every px metric is scaled to (a 12 MP iPhone photo) */
export const REF_EDGE = 4032;

/** output UV → source UV (backward map) */
export type UvMap = (u: number, v: number) => [number, number];

/** The body field as a backward map: uv + bilinear field(uv), the exact arithmetic of cpuWarp.fieldAt (inlined). */
export function fieldMap(f: BodyField | null): UvMap {
  if (!f) return (u, v) => [u, v];
  const { width: w, height: h, data } = f;
  return (u, v) => {
    const x = Math.max(0, Math.min(w - 1, u * w - 0.5));
    const y = Math.max(0, Math.min(h - 1, v * h - 0.5));
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(w - 1, x0 + 1);
    const y1 = Math.min(h - 1, y0 + 1);
    const fx = x - x0;
    const fy = y - y0;
    const i00 = (y0 * w + x0) * 2;
    const i01 = (y0 * w + x1) * 2;
    const i10 = (y1 * w + x0) * 2;
    const i11 = (y1 * w + x1) * 2;
    const ax = data[i00] * (1 - fx) + data[i01] * fx;
    const bx = data[i10] * (1 - fx) + data[i11] * fx;
    const ay = data[i00 + 1] * (1 - fx) + data[i01 + 1] * fx;
    const by = data[i10 + 1] * (1 - fx) + data[i11 + 1] * fx;
    return [u + (ax * (1 - fy) + bx * fy), v + (ay * (1 - fy) + by * fy)];
  };
}

/** person-ness at UV from a recorded PersonMask (nearest texel, 0..1) */
export function maskInside(m: PersonMask): (u: number, v: number) => number {
  return (u, v) => {
    const x = Math.min(m.width - 1, Math.max(0, Math.floor(u * m.width)));
    const y = Math.min(m.height - 1, Math.max(0, Math.floor(v * m.height)));
    return m.data[y * m.width + x] / 255;
  };
}

/** The analysis grid: one sample per output pixel of an AW×AH image, with the original person rasterised on it. */
export interface Analysis {
  w: number;
  h: number;
  /** distance (analysis px) from each pixel to the original person, 0 inside */
  dist: Float32Array;
  /** distance along the row to the person, leftwards / rightwards (narrow-gap test) */
  gapL: Float32Array;
  gapR: Float32Array;
}

export function analysisGrid(inside: (u: number, v: number) => number, w: number, h: number): Analysis {
  const ins = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) ins[y * w + x] = inside((x + 0.5) / w, (y + 0.5) / h) >= 0.5 ? 1 : 0;
  const dist = distanceOutside(ins, w, h);
  const gapL = new Float32Array(w * h).fill(1e9);
  const gapR = new Float32Array(w * h).fill(1e9);
  for (let y = 0; y < h; y++) {
    let last = -1e9;
    for (let x = 0; x < w; x++) {
      if (ins[y * w + x]) last = x;
      gapL[y * w + x] = x - last;
    }
    last = 1e9;
    for (let x = w - 1; x >= 0; x--) {
      if (ins[y * w + x]) last = x;
      gapR[y * w + x] = last - x;
    }
  }
  return { w, h, dist, gapL, gapR };
}

/** Forward map (source UV → output UV): the fixed point p = s − D(p) of the backward map; null if it diverges. */
export function forwardMap(map: UvMap, su: number, sv: number): [number, number] | null {
  let [bu, bv] = map(su, sv);
  if (bu === su && bv === sv) return [su, sv];
  let pu = su - (bu - su);
  let pv = sv - (bv - sv);
  for (let i = 0; i < 60; i++) {
    [bu, bv] = map(pu, pv);
    const ru = bu - su;
    const rv = bv - sv;
    if (Math.abs(ru) < 1e-8 && Math.abs(rv) < 1e-8) return [pu, pv];
    pu -= ru;
    pv -= rv;
  }
  return null;
}

const nearest = (an: Analysis, u: number, v: number) =>
  an.dist[Math.min(an.h - 1, Math.max(0, Math.floor(v * an.h))) * an.w + Math.min(an.w - 1, Math.max(0, Math.floor(u * an.w)))];

/** Max residual (analysis px) of the TLS line through the points; 0 for < 2 points. */
function tlsResidual(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i];
    my += ys[i];
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    sxx += a * a;
    syy += b * b;
    sxy += a * b;
  }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy); // principal direction
  const ex = -Math.sin(th);
  const ey = Math.cos(th);
  let r = 0;
  for (let i = 0; i < n; i++) r = Math.max(r, Math.abs((xs[i] - mx) * ex + (ys[i] - my) * ey));
  return r;
}

/**
 * Warp the background points of the straight line {x0 + t·d} (analysis px, t stepping by 1 over [t0, t1]) and return
 * the bend (px @ REF_EDGE) and the visible point count. Points on the person or within `margin` px of it are skipped
 * (they are not background), as are points that leave the frame. `moved` is false when no point moved at all.
 */
function warpedLineBend(an: Analysis, map: UvMap, x0: number, y0: number, dx: number, dy: number, t0: number, t1: number, margin: number) {
  const { w: AW, h: AH } = an;
  const xs: number[] = [];
  const ys: number[] = [];
  let moved = false;
  // only the steps that can land inside the frame (the per-point test below stays the authority)
  let lo = t0;
  let hi = t1;
  for (const [o, d, max] of [
    [x0, dx, AW],
    [y0, dy, AH],
  ]) {
    if (Math.abs(d) < 1e-12) continue;
    const a = (2 - o) / d;
    const b = (max - 2 - o) / d;
    lo = Math.max(lo, Math.min(a, b));
    hi = Math.min(hi, Math.max(a, b));
  }
  const k0 = Math.max(0, Math.floor(lo - t0) - 1);
  const k1 = Math.min(Math.floor(t1 - t0), Math.ceil(hi - t0) + 1);
  for (let k = k0; k <= k1; k++) {
    const t = t0 + k;
    const x = x0 + t * dx;
    const y = y0 + t * dy;
    if (x < 2 || y < 2 || x > AW - 2 || y > AH - 2) continue;
    const u = x / AW;
    const v = y / AH;
    if (nearest(an, u, v) <= margin) continue; // person or its edge
    const f = forwardMap(map, u, v);
    if (!f) continue;
    if (f[0] < 0 || f[1] < 0 || f[0] > 1 || f[1] > 1) continue;
    if (f[0] !== u || f[1] !== v) moved = true;
    xs.push(f[0] * AW);
    ys.push(f[1] * AH);
  }
  return { n: xs.length, moved, bendPx: moved ? (tlsResidual(xs, ys) * REF_EDGE) / Math.max(AW, AH) : 0 };
}

export interface LineFamilyStats {
  /** worst line's max deviation from its TLS fit, px @ REF_EDGE */
  maxPx: number;
  /** lines bent > 1 px / > 4 px @ REF_EDGE */
  n1: number;
  n4: number;
  /** lines with ≥ 20 visible background points */
  lines: number;
}

/**
 * Dense virtual straight lines in direction `deg` (0 = horizontal, 90 = vertical, measured in image px, y down), one
 * every `step` analysis px across the frame; each scored by warpedLineBend.
 */
export function lineFamilyBend(an: Analysis, map: UvMap, deg: number, step = 4): LineFamilyStats {
  const { w: AW, h: AH } = an;
  const rad = (deg * Math.PI) / 180;
  // exact axis directions (the scratch used (0,1) / (1,0) / (√½, ±√½))
  const dx = deg === 90 ? 0 : deg === 0 ? 1 : Math.abs(deg) === 45 ? Math.SQRT1_2 : Math.cos(rad);
  const dy = deg === 90 ? 1 : deg === 0 ? 0 : Math.abs(deg) === 45 ? Math.sign(deg) * Math.SQRT1_2 : Math.sin(rad);
  const nx = -dy;
  const ny = dx;
  const cs = [0, AW * nx, AH * ny, AW * nx + AH * ny];
  const cmin = Math.min(...cs);
  const cmax = Math.max(...cs);
  const L = Math.hypot(AW, AH);
  const st: LineFamilyStats = { maxPx: 0, n1: 0, n4: 0, lines: 0 };
  for (let c = cmin + step / 2; c < cmax; c += step) {
    const r = warpedLineBend(an, map, c * nx, c * ny, dx, dy, -L, L, 2);
    if (r.n < 20) continue;
    st.lines++;
    if (!r.moved) continue;
    if (r.bendPx > 1) st.n1++;
    if (r.bendPx > 4) st.n4++;
    st.maxPx = Math.max(st.maxPx, r.bendPx);
  }
  return st;
}

/** Bend (px @ REF_EDGE) of one given straight segment a → b (UV), e.g. a door frame of a synthetic background. */
export function segmentBend(an: Analysis, map: UvMap, a: readonly [number, number], b: readonly [number, number], margin = 2): number {
  const ax = a[0] * an.w;
  const ay = a[1] * an.h;
  const len = Math.hypot(b[0] * an.w - ax, b[1] * an.h - ay);
  if (len < 1) return 0;
  const dx = (b[0] * an.w - ax) / len;
  const dy = (b[1] * an.h - ay) / len;
  return warpedLineBend(an, map, ax, ay, dx, dy, 0, len, margin).bendPx;
}

export interface BendStats {
  bendV: number;
  bendH: number;
  /** max over the ±45° families */
  bendD45: number;
  /** max over the ±30° families (shallow perspective lines) */
  bendD30: number;
  /** lines over all six families bent > 4 px @ REF_EDGE */
  bent4: number;
}

export function bendStats(an: Analysis, map: UvMap, step = 4): BendStats {
  const r1 = (x: number) => +x.toFixed(1);
  const v = lineFamilyBend(an, map, 90, step);
  const h = lineFamilyBend(an, map, 0, step);
  const dp = lineFamilyBend(an, map, 45, step);
  const dm = lineFamilyBend(an, map, -45, step);
  const tp = lineFamilyBend(an, map, 30, step);
  const tm = lineFamilyBend(an, map, -30, step);
  return {
    bendV: r1(v.maxPx),
    bendH: r1(h.maxPx),
    bendD45: r1(Math.max(dp.maxPx, dm.maxPx)),
    bendD30: r1(Math.max(tp.maxPx, tm.maxPx)),
    bent4: v.n4 + h.n4 + dp.n4 + dm.n4 + tp.n4 + tm.n4,
  };
}

export interface StretchStats {
  /** max background magnification 1/σ_min(J) − 1 over displaced background, % */
  stretchMax: number;
  stretchP99: number;
  /** max stretch inside narrow gaps (person within 4.5 % of H both left and right on the row), % */
  gapStretch: number;
  /** farthest background (distance from the original person, px @ REF_EDGE) displaced > 0.5 px @ REF_EDGE */
  ringPx: number;
  /** max displacement (px @ REF_EDGE) of output pixels farther than 15 % of H from the person (must stay 0) */
  farMovePx: number;
  /** max background displacement, px @ REF_EDGE */
  maxBgDispPx: number;
  /** how far (px @ REF_EDGE) any output pixel samples outside the frame (must stay 0) */
  outsidePx: number;
}

export function stretchStats(an: Analysis, map: UvMap): StretchStats {
  const { w: AW, h: AH } = an;
  const toRef = REF_EDGE / Math.max(AW, AH);
  const hh = 0.5;
  let stretchMax = 0;
  let ringPx = 0;
  let farMove = 0;
  let maxBg = 0;
  let gap = 0;
  let outside = 0;
  const stretches: number[] = [];
  const G = 0.045 * AH;
  const FAR = 0.15 * AH;
  for (let y = 0; y < AH; y++) {
    for (let x = 0; x < AW; x++) {
      const u = (x + 0.5) / AW;
      const v = (y + 0.5) / AH;
      const s = map(u, v);
      const out = Math.max(0, -s[0], s[0] - 1) * AW + Math.max(0, -s[1], s[1] - 1) * AH;
      if (out > 0) outside = Math.max(outside, out * toRef);
      const disp = Math.hypot((s[0] - u) * AW, (s[1] - v) * AH) * toRef;
      if (an.dist[y * AW + x] > FAR) farMove = Math.max(farMove, disp);
      if (y < 1 || x < 1 || y >= AH - 1 || x >= AW - 1) continue;
      const si = Math.min(AH - 1, Math.max(0, Math.floor(s[1] * AH))) * AW + Math.min(AW - 1, Math.max(0, Math.floor(s[0] * AW)));
      const d = an.dist[si];
      if (d <= 2) continue; // samples the person or its edge
      if (disp <= 0.5) continue;
      const a = map(u + hh / AW, v);
      const b = map(u - hh / AW, v);
      const c = map(u, v + hh / AH);
      const e = map(u, v - hh / AH);
      const j11 = ((a[0] - b[0]) * AW) / (2 * hh);
      const j21 = ((a[1] - b[1]) * AH) / (2 * hh);
      const j12 = ((c[0] - e[0]) * AW) / (2 * hh);
      const j22 = ((c[1] - e[1]) * AH) / (2 * hh);
      const S = j11 * j11 + j12 * j12 + j21 * j21 + j22 * j22;
      const det = j11 * j22 - j12 * j21;
      const smin = Math.sqrt(Math.max(0, (S - Math.sqrt(Math.max(0, S * S - 4 * det * det))) / 2));
      const stretch = smin > 1e-6 ? 1 / smin - 1 : 99;
      stretches.push(stretch);
      stretchMax = Math.max(stretchMax, stretch * 100);
      maxBg = Math.max(maxBg, disp);
      ringPx = Math.max(ringPx, d * toRef);
      if (an.gapL[si] < G && an.gapR[si] < G) gap = Math.max(gap, stretch * 100);
    }
  }
  stretches.sort((p, q) => p - q);
  const p99 = stretches.length ? stretches[Math.floor(0.99 * (stretches.length - 1))] * 100 : 0;
  const r1 = (x: number) => +x.toFixed(1);
  return {
    stretchMax: r1(stretchMax),
    stretchP99: r1(p99),
    gapStretch: r1(gap),
    ringPx: r1(ringPx),
    farMovePx: r1(farMove),
    maxBgDispPx: r1(maxBg),
    outsidePx: r1(outside),
  };
}

/** Draft (128) vs commit (256): max |D_draft − D_commit| over the background (every 2nd px), px @ REF_EDGE. */
export function draftJumpPx(an: Analysis, draft: BodyField | null, commit: BodyField | null): number {
  const { w: AW, h: AH } = an;
  const toRef = REF_EDGE / Math.max(AW, AH);
  const a = fieldMap(commit);
  const b = fieldMap(draft);
  let mx = 0;
  for (let y = 0; y < AH; y += 2)
    for (let x = 0; x < AW; x += 2) {
      if (an.dist[y * AW + x] <= 2) continue;
      const u = (x + 0.5) / AW;
      const v = (y + 0.5) / AH;
      const p = a(u, v);
      const q = b(u, v);
      mx = Math.max(mx, Math.hypot((p[0] - q[0]) * AW, (p[1] - q[1]) * AH) * toRef);
    }
  return +mx.toFixed(1);
}

export interface BodyMetrics extends BendStats, StretchStats {
  minDet: number;
}

/** Everything the ratchet / B1 record for one field on one analysis grid. */
export function bodyMetrics(an: Analysis, field: BodyField | null): BodyMetrics {
  const map = fieldMap(field);
  return { ...bendStats(an, map), ...stretchStats(an, map), minDet: field ? +fieldMinJacobian(field).toFixed(2) : 1 };
}

// ───────────────────────── 瘦臉 (face reshape) ─────────────────────────

export interface FaceMetrics {
  /** face width (contour point 0 → 32), photo px */
  fwPx: number;
  /** max displacement within 5 % FW outside the face oval, % FW */
  nearOvalPctFW: number;
  /** farthest point outside the oval displaced > 0.5 % FW, measured from the oval, % FW */
  ovalReachPctFW: number;
  /** max displacement of background (> 1 grid px outside the person), % FW */
  bgMaxPctFW: number;
  /** farthest background (from the person) displaced > 1 photo px, % FW */
  bgReachPctFW: number;
  /** virtual background line bends, % FW */
  bendVPctFW: number;
  bendHPctFW: number;
  bendDPctFW: number;
}

/**
 * 瘦臉 reach and background damage of `map` (e.g. reshapeMapCpu) on a `width`×`height` photo, analysed on a half-res
 * grid. `inside` = the person (for the background columns).
 */
export function faceMetrics(face: Face, width: number, height: number, map: UvMap, inside: (u: number, v: number) => number): FaceMetrics {
  const W = Math.round(width / 2);
  const H = Math.round(height / 2);
  const an = analysisGrid(inside, W, H);
  const P = face.pts111;
  const FW = Math.hypot((P[0] - P[64]) * width, (P[1] - P[65]) * height);
  const oval = face.oval;
  const n = oval.length / 2;
  const inOval = (u: number, v: number) => {
    let c = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = oval[i * 2];
      const yi = oval[i * 2 + 1];
      const xj = oval[j * 2];
      const yj = oval[j * 2 + 1];
      if (yi > v !== yj > v && u < ((xj - xi) * (v - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const ovalDist = (u: number, v: number) => {
    let m = Infinity;
    const px = u * width;
    const py = v * height;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ax = oval[j * 2] * width;
      const ay = oval[j * 2 + 1] * height;
      const dx = oval[i * 2] * width - ax;
      const dy = oval[i * 2 + 1] * height - ay;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
      m = Math.min(m, Math.hypot(px - ax - t * dx, py - ay - t * dy));
    }
    return m;
  };
  let reach = 0;
  let near = 0;
  let bgMax = 0;
  let bgFar = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W;
      const v = (y + 0.5) / H;
      const s = map(u, v);
      const d = Math.hypot((s[0] - u) * width, (s[1] - v) * height);
      if (x % 2 === 0 && y % 2 === 0 && d > 0.005 * FW && !inOval(u, v)) {
        const od = ovalDist(u, v);
        reach = Math.max(reach, od);
        if (od < 0.05 * FW) near = Math.max(near, d);
      }
      const di = an.dist[y * W + x];
      if (di > 1) {
        if (d > 1) bgFar = Math.max(bgFar, (di * width) / W);
        bgMax = Math.max(bgMax, d);
      }
    }
  const toPhoto = Math.max(width, height) / REF_EDGE; // bends come @ REF_EDGE
  const pct = (px: number, k = 1) => +((100 * px) / FW).toFixed(k);
  const bend = (deg: number) => lineFamilyBend(an, map, deg, 3).maxPx * toPhoto;
  return {
    fwPx: +FW.toFixed(0),
    nearOvalPctFW: pct(near),
    ovalReachPctFW: pct(reach, 0),
    bgMaxPctFW: pct(bgMax),
    bgReachPctFW: pct(bgFar, 0),
    bendVPctFW: pct(bend(90), 2),
    bendHPctFW: pct(bend(0), 2),
    bendDPctFW: pct(Math.max(bend(45), bend(-45)), 2),
  };
}
