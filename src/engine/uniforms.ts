// Pure engine math: tier sizes, buffer sizes, mean-kernel geometry and the BeautyParams → skin
// uniform mapping (RB §5 "Engine mapping" column). No GL here, so all of it is unit-tested.
import type { BeautyParams, Tier } from '../types';
import { fitShortEdge } from './gl/gl';

export interface Size {
  width: number;
  height: number;
}

/** Live processing short edge per tier (spec §5). */
export const TIER_SHORT_EDGE: Readonly<Record<Tier, number>> = { H: 1080, M: 720, L: 540 };

/**
 * Processing resolution. Live: short edge capped by the tier (never upscaled). Still / capture:
 * the source size. Both are additionally capped to `maxSize` on the long edge (GL limits).
 */
export function processingSize(width: number, height: number, tier: Tier, still: boolean, maxSize = Infinity): Size {
  let s: Size = still ? { width: Math.round(width), height: Math.round(height) } : fitShortEdge(width, height, TIER_SHORT_EDGE[tier]);
  const long = Math.max(s.width, s.height);
  if (long > maxSize) {
    const k = maxSize / long;
    s = { width: Math.max(1, Math.floor(s.width * k)), height: Math.max(1, Math.floor(s.height * k)) };
  }
  return s;
}

/** Mean (P3/P4) buffer size: half resolution on live tier L, full otherwise. */
export function meanBufferSize(size: Size, halfRes: boolean): Size {
  if (!halfRes) return { width: size.width, height: size.height };
  return { width: Math.max(1, Math.round(size.width / 2)), height: Math.max(1, Math.round(size.height / 2)) };
}

/** P0 face-mask buffer: ¼ of the processing size per axis (the mask is heavily feathered). */
export function maskBufferSize(size: Size): Size {
  return { width: Math.max(1, Math.ceil(size.width / 4)), height: Math.max(1, Math.ceil(size.height / 4)) };
}

// ── P3/P4 sparse mean (GPUPixel BoxBlur: radius 4, texelSpacingMultiplier 4, RB §2.3) ──

/** GPUPixel texel spacing multiplier for the beauty box blur. */
export const MEAN_SPACING = 4;
/** Optimised GPUImage box offsets for radius 4: (i·2)+1.5 for i = 0, 1. */
export const MEAN_TAP_OFFSETS: readonly number[] = [1.5, 3.5];
/** boxWeight = 1/(2·radius+1); centre tap 1/9, each paired tap 2/9. */
export const MEAN_WEIGHTS = { center: 1 / 9, side: 2 / 9 } as const;
/** GPUPixel's pixel offsets are defined here; other resolutions scale by shortEdge/720. */
export const MEAN_REFERENCE_SHORT_EDGE = 720;

export function meanScale(size: Size): number {
  return Math.min(size.width, size.height) / MEAN_REFERENCE_SHORT_EDGE;
}

/**
 * UV step of one "offset unit" along `axis`, computed from the PROCESSING size (not the mean buffer
 * size), so the half-res mean of tier L covers the same image footprint.
 */
export function meanStep(size: Size, axis: 'h' | 'v'): [number, number] {
  const unit = MEAN_SPACING * meanScale(size);
  return axis === 'h' ? [unit / size.width, 0] : [0, unit / size.height];
}

/**
 * UV step of the P5 sharpen taps: GPUPixel's 1 px at a 720 short edge, scaled by shortEdge/720
 * like the mean (unclamped, as meanStep), so the live tiers and the full-resolution capture
 * sharpen the same image footprint.
 */
export function sharpenTexel(size: Size): [number, number] {
  const k = meanScale(size);
  return [k / size.width, k / size.height];
}

/** Signed tap offsets in processing pixels along one axis (for tests / docs): {0, ±1.5, ±3.5}·4·scale. */
export function meanTapPixels(size: Size): number[] {
  const unit = MEAN_SPACING * meanScale(size);
  const out = [0];
  for (const o of MEAN_TAP_OFFSETS) out.push(o * unit, -o * unit);
  return out;
}

// ── P5 composite uniforms ──

export interface SkinUniforms {
  /** GPUPixel blurAlpha = v */
  smooth: number;
  /** GPUPixel sharpen = 2·v (iOS demo range 0..2) */
  sharpen: number;
  /** GPUPixel whiten = 0.5·v (iOS demo max 0.5); the shader fades the chain in over 0..0.1 */
  whiten: number;
  /** soft-light opacity toward ROSY_TINT, = 0.35·v (further × skin ramp × mask in the shader) */
  rosy: number;
  /** LUT mix; 0 when no filter or its LUT is not uploaded yet */
  filterAmount: number;
}

export const ROSY_MAX_OPACITY = 0.35;
/** soft-light blend colour for 紅潤 (RB §2.5) */
export const ROSY_TINT = '#FFB8C2';

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

export function skinUniforms(params: BeautyParams, filterAvailable: boolean): SkinUniforms {
  const v = params.values;
  return {
    smooth: clamp01(v['skin.smooth']),
    sharpen: 2 * clamp01(v['skin.sharpen']),
    whiten: 0.5 * clamp01(v['skin.whiten']),
    rosy: ROSY_MAX_OPACITY * clamp01(v['skin.rosy']),
    filterAmount: filterAvailable && params.filterId !== 'none' ? clamp01(v['filter.amount']) : 0,
  };
}

/** Mean buffers are needed for smoothing and for the skin ramp `p` that weights rosy. */
export function needsMean(u: SkinUniforms): boolean {
  return u.smooth > 0 || u.rosy > 0;
}

/**
 * Clip-space scale for the present vertex shader: x = −1 mirrors, y = −1 flips the image so
 * texture row 0 (image top) lands at the top of the canvas.
 */
export function presentScale(flipY: boolean, mirrorX: boolean): [number, number] {
  return [mirrorX ? -1 : 1, flipY ? -1 : 1];
}
