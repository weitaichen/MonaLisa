// Background relaxation of the local 美體 field (reports/美體修圖 背景扭曲 抑制技術.md, stage 1 ①).
//
// The local primitives put their whole falloff into a fixed profile (φ = (1 − r²)², the 背景保護 ramp), so the
// background next to a slimmed part is magnified most in a thin shell (2× beside an arm). Here the background part
// of the field is re-solved as a screened membrane on the field grid:
//
//   min Σ_edges (E_i − E_j)² + Σ_i α_i (E_i − D_i)²
//
// over the background texels near the moving region (the domain). Person texels, texels outside the domain, narrow
// background gaps and the frame border are fixed to the original field D, so the person is warped exactly as before,
// nothing beyond the domain starts to move, and the frame edge keeps the field keepInFrame (field.ts) was tuned for
// (a free border would carry the ring out to the edge, where keepInFrame then squeezes it into the last strip). The
// silhouette's displacement is then spread evenly over the ring instead of being squeezed into the profile's
// steepest part.
//
// Fold-aware repair: a harmonic fill can still steepen the field where the boundary data bend sharply (the corner
// between a carried arm and the torso, where both sides move differently: the regression the research measured).
// After each solve, every grid cell whose det J fell below min(its det in D, repairFloor) raises the data weight
// of its texels, and the system is re-solved warm, so the original field is kept where relaxing would fold it,
// and only there.
//
// Linear in D for a fixed domain, so field.ts's fold guard (which scales the finished local part) still applies.
// Pure TS on typed arrays, no DOM.

export interface RelaxOptions {
  /** screening weight α per texel² of a BODY_FIELD_LONG_EDGE grid (field.ts scales it with the grid, so drafts match) */
  alpha: number;
  /** the domain: background within `margin` (Q units) of a texel moving more than `moveEps` (Q units) … */
  margin: number;
  moveEps: number;
  /** … but the margin never grows it past `maxReach` (Q units) from the person */
  maxReach: number;
  /** narrow gaps (a background run along a row or column with the person at both ends, ≤ gapMax Q units) keep D */
  gapMax: number;
  /** fold-aware repair: cells with det J < min(det in D, repairFloor) get their data weight ×repairFactor … */
  repairFloor: number;
  repairFactor: number;
  /** … for at most this many re-solves */
  repairRounds: number;
  /** CG stop: RMS residual ≤ tol · α (≈ RMS error ≤ tol, Q units) */
  tol: number;
  maxIter: number;
}

export interface RelaxStats {
  unknowns: number;
  /** CG iterations over all solves */
  iters: number;
  /** repair rounds that found a cell to fix */
  rounds: number;
}

/**
 * Relax gx / gy (Q-space displacement on a w×h grid of square texels of Q size `texel`) in place. `inside` = the
 * person on the grid, `dist` = distanceOutside(inside) in texels, `alphaScale` converts opts.alpha to this grid.
 */
export function relaxBackground(
  gx: Float32Array,
  gy: Float32Array,
  inside: Uint8Array,
  dist: Float32Array,
  w: number,
  h: number,
  texel: number,
  opts: RelaxOptions,
  alphaScale: number,
): RelaxStats {
  const N = w * h;
  const alpha = opts.alpha * alphaScale;
  const none: RelaxStats = { unknowns: 0, iters: 0, rounds: 0 };

  // ── domain: moving texels, grown by the margin (within maxReach of the person), minus the fixed texels ──
  const moving = new Uint8Array(N);
  let anyMoving = false;
  for (let i = 0; i < N; i++)
    if (Math.abs(gx[i]) > opts.moveEps || Math.abs(gy[i]) > opts.moveEps) {
      moving[i] = 1;
      anyMoving = true;
    }
  if (!anyMoving) return none;
  const dom = Uint8Array.from(moving);
  dilateChebyshev(dom, w, h, Math.round(opts.margin / texel));
  const reach = opts.maxReach / texel;
  const fixed = Uint8Array.from(inside);
  markGaps(inside, w, h, Math.floor(opts.gapMax / texel), fixed);
  const unk = new Int32Array(N).fill(-1);
  let n = 0;
  // the frame border is fixed too (keeps D): keepInFrame (field.ts) later pins the outward displacement there, and a
  // free border would let the fill carry the ring out to the edge, where that pin then squeezes it
  for (let i = 0; i < N; i++) {
    if (!dom[i] || fixed[i] || !(moving[i] || dist[i] <= reach)) continue;
    const x = i % w;
    const y = (i - x) / w;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) continue;
    unk[i] = n++;
  }
  if (!n) return none;
  const idx = new Int32Array(n);
  for (let i = 0; i < N; i++) if (unk[i] >= 0) idx[unk[i]] = i;

  // ── system: per unknown its 4 neighbours (unknown index or −1), diagonal, right-hand side ──
  const nb = new Int32Array(4 * n).fill(-1);
  const aK = new Float64Array(n); // data weight per unknown (raised by the repair)
  const diag = new Float64Array(n);
  const bX = new Float64Array(n);
  const bY = new Float64Array(n);
  const zX = new Float64Array(n);
  const zY = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const i = idx[k];
    const x = i % w;
    const y = (i - x) / w;
    let d = alpha;
    let bx = alpha * gx[i];
    let by = alpha * gy[i];
    const link = (slot: number, j: number) => {
      d += 1;
      const u = unk[j];
      nb[4 * k + slot] = u;
      if (u < 0) {
        bx += gx[j];
        by += gy[j];
      }
    };
    if (x > 0) link(0, i - 1);
    if (x + 1 < w) link(1, i + 1);
    if (y > 0) link(2, i - w);
    if (y + 1 < h) link(3, i + w);
    aK[k] = alpha;
    diag[k] = d;
    bX[k] = bx;
    bY[k] = by;
    zX[k] = gx[i]; // warm start from D
    zY[k] = gy[i];
  }
  const tolRms = opts.tol * alpha;
  let iters = pcg2(n, nb, diag, bX, bY, zX, zY, tolRms, opts.maxIter);

  // ── fold-aware repair ──
  let rounds = 0;
  if (opts.repairRounds > 0) {
    // only cells touching an unknown can change: their bounding box
    let x0 = w;
    let x1 = 0;
    let y0 = h;
    let y1 = 0;
    for (let k = 0; k < n; k++) {
      const x = idx[k] % w;
      const y = (idx[k] - x) / w;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    x0 = Math.max(0, x0 - 1);
    y0 = Math.max(0, y0 - 1);
    x1 = Math.min(w - 2, x1);
    y1 = Math.min(h - 2, y1);
    const s = 1 / texel;
    const ex = Float32Array.from(gx);
    const ey = Float32Array.from(gy);
    const raised = new Uint8Array(n);
    for (; rounds < opts.repairRounds; rounds++) {
      for (let k = 0; k < n; k++) {
        ex[idx[k]] = zX[k];
        ey[idx[k]] = zY[k];
      }
      raised.fill(0);
      let bad = 0;
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const i = y * w + x;
          if (unk[i] < 0 && unk[i + 1] < 0 && unk[i + w] < 0 && unk[i + w + 1] < 0) continue;
          const dE = cellDet(ex, ey, w, i, s);
          // slack: once the weights pin E to D, float noise must not count as a worse cell
          if (dE >= opts.repairFloor || dE >= cellDet(gx, gy, w, i, s) - 0.005) continue;
          bad++;
          // the cell's corners and their 4-neighbours
          for (const c of [i, i + 1, i + w, i + w + 1])
            for (const j of [c, c - 1, c + 1, c - w, c + w]) {
              const k = j >= 0 && j < N ? unk[j] : -1;
              if (k < 0 || raised[k]) continue;
              raised[k] = 1;
              const da = aK[k] * (opts.repairFactor - 1);
              aK[k] += da;
              diag[k] += da;
              bX[k] += da * gx[idx[k]];
              bY[k] += da * gy[idx[k]];
            }
        }
      if (!bad) break;
      iters += pcg2(n, nb, diag, bX, bY, zX, zY, tolRms, opts.maxIter);
    }
  }
  for (let k = 0; k < n; k++) {
    gx[idx[k]] = zX[k];
    gy[idx[k]] = zY[k];
  }
  return { unknowns: n, iters, rounds };
}

/**
 * Jacobi-preconditioned CG on the two decoupled components in lock-step (same matrix: `diag` on the diagonal, −1
 * for each unknown neighbour). z holds the start value and receives the solution; returns the iterations used.
 */
function pcg2(
  n: number,
  nb: Int32Array,
  diag: Float64Array,
  bX: Float64Array,
  bY: Float64Array,
  zX: Float64Array,
  zY: Float64Array,
  tolRms: number,
  maxIter: number,
): number {
  const rX = new Float64Array(n);
  const rY = new Float64Array(n);
  const pX = new Float64Array(n);
  const pY = new Float64Array(n);
  const qX = new Float64Array(n);
  const qY = new Float64Array(n);
  const mul = (sX: Float64Array, sY: Float64Array) => {
    for (let k = 0; k < n; k++) {
      let ax = diag[k] * sX[k];
      let ay = diag[k] * sY[k];
      for (let o = 4 * k, e = o + 4; o < e; o++) {
        const j = nb[o];
        if (j >= 0) {
          ax -= sX[j];
          ay -= sY[j];
        }
      }
      qX[k] = ax;
      qY[k] = ay;
    }
  };
  mul(zX, zY);
  let rzX = 0;
  let rzY = 0;
  let rrX = 0;
  let rrY = 0;
  for (let k = 0; k < n; k++) {
    const ex = bX[k] - qX[k];
    const ey = bY[k] - qY[k];
    rX[k] = ex;
    rY[k] = ey;
    pX[k] = ex / diag[k];
    pY[k] = ey / diag[k];
    rzX += ex * pX[k];
    rzY += ey * pY[k];
    rrX += ex * ex;
    rrY += ey * ey;
  }
  const lim = tolRms * tolRms * n;
  let doneX = rrX <= lim;
  let doneY = rrY <= lim;
  let it = 0;
  for (; it < maxIter && !(doneX && doneY); it++) {
    mul(pX, pY);
    let pqX = 0;
    let pqY = 0;
    for (let k = 0; k < n; k++) {
      pqX += pX[k] * qX[k];
      pqY += pY[k] * qY[k];
    }
    const aX = doneX || !(pqX > 0) ? 0 : rzX / pqX;
    const aY = doneY || !(pqY > 0) ? 0 : rzY / pqY;
    let nzX = 0;
    let nzY = 0;
    rrX = 0;
    rrY = 0;
    for (let k = 0; k < n; k++) {
      zX[k] += aX * pX[k];
      zY[k] += aY * pY[k];
      const ex = (rX[k] -= aX * qX[k]);
      const ey = (rY[k] -= aY * qY[k]);
      rrX += ex * ex;
      rrY += ey * ey;
      nzX += (ex * ex) / diag[k];
      nzY += (ey * ey) / diag[k];
    }
    doneX ||= rrX <= lim || aX === 0;
    doneY ||= rrY <= lim || aY === 0;
    const btX = rzX > 0 ? nzX / rzX : 0;
    const btY = rzY > 0 ? nzY / rzY : 0;
    rzX = nzX;
    rzY = nzY;
    for (let k = 0; k < n; k++) {
      pX[k] = rX[k] / diag[k] + btX * pX[k];
      pY[k] = rY[k] / diag[k] + btY * pY[k];
    }
  }
  return it;
}

/** det J of the bilinear cell with top-left texel i (min over its corners, as fieldMinJacobian; s = texels per unit). */
export function cellDet(gx: Float32Array, gy: Float32Array, w: number, i: number, s: number): number {
  const ax0 = 1 + (gx[i + 1] - gx[i]) * s;
  const ay0 = (gy[i + 1] - gy[i]) * s;
  const ax1 = 1 + (gx[i + w + 1] - gx[i + w]) * s;
  const ay1 = (gy[i + w + 1] - gy[i + w]) * s;
  const bx0 = (gx[i + w] - gx[i]) * s;
  const by0 = 1 + (gy[i + w] - gy[i]) * s;
  const bx1 = (gx[i + w + 1] - gx[i + 1]) * s;
  const by1 = 1 + (gy[i + w + 1] - gy[i + 1]) * s;
  return Math.min(ax0 * by0 - ay0 * bx0, ax0 * by1 - ay0 * bx1, ax1 * by0 - ay1 * bx0, ax1 * by1 - ay1 * bx1);
}

/** In-place Chebyshev dilation of a 0/1 grid by r texels (separable running max). */
export function dilateChebyshev(g: Uint8Array, w: number, h: number, r: number): void {
  if (r <= 0) return;
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let last = -Infinity; // nearest set texel at or left of x
    for (let x = 0; x < w; x++) {
      if (g[o + x]) last = x;
      if (x - last <= r) tmp[o + x] = 1;
    }
    last = Infinity;
    for (let x = w - 1; x >= 0; x--) {
      if (g[o + x]) last = x;
      if (last - x <= r) tmp[o + x] = 1;
    }
  }
  g.fill(0);
  for (let x = 0; x < w; x++) {
    let last = -Infinity;
    for (let y = 0; y < h; y++) {
      if (tmp[y * w + x]) last = y;
      if (y - last <= r) g[y * w + x] = 1;
    }
    last = Infinity;
    for (let y = h - 1; y >= 0; y--) {
      if (tmp[y * w + x]) last = y;
      if (last - y <= r) g[y * w + x] = 1;
    }
  }
}

/**
 * Narrow background gaps (arm–torso, between the legs): runs of background along a row or a column with the person
 * at both ends, at most `maxLen` texels long, are marked in `out`.
 */
export function markGaps(inside: Uint8Array, w: number, h: number, maxLen: number, out: Uint8Array): void {
  if (maxLen <= 0) return;
  const scan = (lines: number, len: number, at: (line: number, s: number) => number) => {
    for (let line = 0; line < lines; line++) {
      let start = -1; // first background texel after a person texel (−1: none seen on this line yet)
      for (let s = 0; s < len; s++) {
        if (!inside[at(line, s)]) continue;
        if (start >= 0 && s > start && s - start <= maxLen) for (let t = start; t < s; t++) out[at(line, t)] = 1;
        start = s + 1;
      }
    }
  };
  scan(h, w, (y, x) => y * w + x);
  scan(w, h, (x, y) => y * w + x);
}
