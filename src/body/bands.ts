// Full-width vertical stretch bands (長腿, manual 增高). D_y depends on y only, so horizontal AND vertical lines stay
// straight (BR §垂直於骨骼的位移場); only diagonals bend gently inside the ramps.
//
// A band stretches SOURCE rows [a, b] by S (b = Infinity for 長腿: everything below the hip line). The local stretch
// is σ(y) = 1 + Σ (S − 1)·w(y) with w a smoothstep window (ramps of half-width r centred on a and b), so the
// forward map F(y) = y + Σ (S − 1)·∫w is C², and F′ = σ ≥ 1 makes it strictly monotonic: no fold-over by
// construction. The engine needs the BACKWARD map g = F⁻¹ (output row → source row), solved per field row by
// safeguarded Newton. For y past the last ramp, g(y) = a + (y − a)/S exactly — the report's legBand, with the
// window placed on the source rows (where the anatomy is) instead of on the output rows.

export interface Band {
  /** source row where the stretch starts (UV y, top-left origin) */
  a: number;
  /** source row where it ends; Infinity = to the bottom edge */
  b: number;
  /** ramp half-width (UV y) */
  r: number;
  /** stretch factor ≥ 1 inside the band */
  S: number;
}

/** ∫₀^τ smoothstep, continued linearly past τ = 1. */
function J(tau: number): number {
  if (tau <= 0) return 0;
  if (tau >= 1) return tau - 0.5;
  return tau * tau * tau - 0.5 * tau * tau * tau * tau;
}

function ss(tau: number): number {
  const t = tau <= 0 ? 0 : tau >= 1 ? 1 : tau;
  return t * t * (3 - 2 * t);
}

/** ∫_{−∞}^{y} w — rows of stretch accumulated above y. */
export function bandIntegral(band: Band, y: number): number {
  const r2 = 2 * band.r;
  const up = r2 * J((y - (band.a - band.r)) / r2);
  const down = Number.isFinite(band.b) ? r2 * J((y - (band.b - band.r)) / r2) : 0;
  return up - down;
}

export function bandWindow(band: Band, y: number): number {
  const r2 = 2 * band.r;
  const up = ss((y - (band.a - band.r)) / r2);
  const down = Number.isFinite(band.b) ? ss((y - (band.b - band.r)) / r2) : 0;
  return up - down;
}

/** Forward map: where source row y lands in the output. */
export function forwardY(bands: readonly Band[], y: number): number {
  let f = y;
  for (const b of bands) f += (b.S - 1) * bandIntegral(b, y);
  return f;
}

/** F′(y) = local vertical stretch at source row y (≥ 1). */
export function forwardSlope(bands: readonly Band[], y: number): number {
  let s = 1;
  for (const b of bands) s += (b.S - 1) * bandWindow(b, y);
  return s;
}

/** Backward map g = F⁻¹: the source row shown at output row y. */
export function backwardY(bands: readonly Band[], y: number): number {
  if (!bands.length) return y;
  // F(x) ≥ x, so the root is ≤ y; F′ ∈ [1, Smax] keeps Newton tame, bisection guards the rest
  let lo = y - 2;
  let hi = y;
  let x = y;
  for (let i = 0; i < 30; i++) {
    const fx = forwardY(bands, x) - y;
    if (Math.abs(fx) < 1e-10) return x;
    if (fx > 0) hi = x;
    else lo = x;
    const nx = x - fx / forwardSlope(bands, x);
    x = nx > lo && nx < hi ? nx : (lo + hi) / 2;
  }
  return x;
}

/** Manual 增高 band: stretch 1 + 0.15·amount, limited so the content pushed off the bottom stays ≤ 8 % of the height. */
export const HEIGHT_GAIN = 0.15;
export const HEIGHT_MAX_CROP = 0.08;

/**
 * The stretch S heightBand applies to a {top, bottom, amount} band (1 when it is off). The HeightBandOverlay
 * draws its lower line at top + (bottom − top)·S, where the stretched rows end in the output.
 */
export function heightBandStretch(band: { top: number; bottom: number; amount: number }): number {
  const length = band.bottom - band.top;
  if (!(length > 0) || !(band.amount > 0)) return 1;
  return 1 + Math.min(HEIGHT_GAIN * band.amount, HEIGHT_MAX_CROP / length);
}

export function heightBand(top: number, bottom: number, amount: number): Band | null {
  const length = bottom - top;
  if (!(length > 0) || !(amount > 0)) return null;
  const S = heightBandStretch({ top, bottom, amount });
  const r = Math.min(0.03, length / 4);
  // keep the upper ramp inside the image so row 0 still maps to row 0
  const a = Math.max(top, r);
  return { a, b: Math.max(a + 2 * r, bottom), r, S };
}

/**
 * 長腿 band from the hip line down to the ankles (`ankleY`; omitted = to the bottom edge). Below the ankles the feet,
 * shoes and floor are shifted down unscaled, as 增高 does: stretching them too reads as oversized boots and smears
 * the floor. S = 1 + 0.12·s, clamped so the lowest foot point stays `margin` inside the bottom edge after every
 * band (the frame size is unchanged, so the stretch can only push content off the bottom).
 */
export const LEGS_GAIN = 0.12;
export const FEET_MARGIN = 0.02;

export function legsBand(hipY: number, kneeY: number, feetY: number, s: number, others: readonly Band[], ankleY?: number): Band | null {
  if (!(s > 0)) return null;
  const r = Math.max(0.01, Math.min(0.04, 0.4 * (kneeY - hipY)));
  // the lower ramp ends at the ankle, so the stretch is fully off on the feet
  const b = ankleY !== undefined && Number.isFinite(ankleY) ? Math.max(hipY + 2 * r, ankleY - r) : Infinity;
  const probe: Band = { a: hipY, b, r, S: 2 };
  const room = 1 - FEET_MARGIN - forwardY(others, feetY); // output rows left below the feet
  const per = bandIntegral(probe, feetY); // output rows gained per unit of (S − 1)
  const sMax = per > 1e-9 ? room / per : 0;
  const S = 1 + Math.min(LEGS_GAIN * s, Math.max(0, sMax));
  return S > 1 + 1e-6 ? { a: hipY, b, r, S } : null;
}
