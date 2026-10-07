// Pure pieces of the live loop (no DOM, no GL) so they can be unit-tested with fake timers:
// face-weight easing, time-based EMA, the auto-tier state machine and per-frame scheduling decisions.
import type { Tier } from '../types';

/** spec §5: landmark effects fade in/out over ~150 ms on face gain/loss. */
export const FACE_EASE_MS = 150;

/** Auto-tier policy (plan T8): measure after a 3 s warm-up; step down when the smoothed frame cost
 * stays above 40 ms (= below 25 fps) for 1.5 s. */
export const AUTO_TIER = {
  warmupMs: 3000,
  budgetMs: 40,
  sustainMs: 1500,
  /** EMA time constant for the frame cost */
  tauMs: 300,
} as const;

export type AutoTierConfig = { readonly [K in keyof typeof AUTO_TIER]: number };

/**
 * Exponential moving average whose smoothing depends on elapsed time rather than sample count,
 * so it behaves the same at 15 fps and 60 fps. The first sample initialises it.
 */
export class TimeEma {
  private v: number | null = null;

  constructor(private readonly tauMs: number) {}

  update(sample: number, dtMs: number): number {
    if (!Number.isFinite(sample)) return this.v ?? 0;
    if (this.v === null) this.v = sample;
    else this.v += (sample - this.v) * (1 - Math.exp(-Math.max(0, dtMs) / this.tauMs));
    return this.v;
  }

  get value(): number | null {
    return this.v;
  }

  reset(): void {
    this.v = null;
  }
}

/**
 * Eases faceWeight toward 1 (face present) or 0 (face lost) over `durationMs`.
 * State is a linear progress value; the output is smoothstep-shaped so the warp/makeup strength
 * starts and ends without a visible kink, and a reversal mid-fade stays continuous.
 */
export class FaceWeightEaser {
  private t: number;

  constructor(
    private readonly durationMs = FACE_EASE_MS,
    initial = 0,
  ) {
    this.t = clamp01(initial);
  }

  update(present: boolean, dtMs: number): number {
    const step = this.durationMs > 0 ? Math.max(0, dtMs) / this.durationMs : 1;
    this.t = present ? Math.min(1, this.t + step) : Math.max(0, this.t - step);
    return this.value;
  }

  get value(): number {
    const t = this.t;
    return t * t * (3 - 2 * t);
  }

  reset(value = 0): void {
    this.t = clamp01(value);
  }
}

/** H → M → L; null when already at the lowest tier. */
export function nextLowerTier(t: Tier): Tier | null {
  return t === 'H' ? 'M' : t === 'M' ? 'L' : null;
}

/**
 * Auto step-down detector. Feed one sample per processed frame; `sample()` returns true exactly when
 * the caller should drop one tier (the caller then calls `restart()` so the new tier gets its own
 * warm-up). It never asks to step up: the plan forbids automatic step-up within a session.
 */
export class AutoTier {
  private readonly ema: TimeEma;
  private startedAt: number | null = null;
  private overSince: number | null = null;

  constructor(private readonly cfg: AutoTierConfig = AUTO_TIER) {
    this.ema = new TimeEma(cfg.tauMs);
  }

  /** Begin a fresh measurement window (loop start, resume after a pause, tier/geometry change). */
  restart(): void {
    this.startedAt = null;
    this.overSince = null;
    this.ema.reset();
  }

  get smoothedMs(): number | null {
    return this.ema.value;
  }

  sample(nowMs: number, frameCostMs: number, dtMs: number): boolean {
    if (this.startedAt === null) this.startedAt = nowMs;
    const ema = this.ema.update(frameCostMs, dtMs);
    if (nowMs - this.startedAt < this.cfg.warmupMs) {
      this.overSince = null;
      return false;
    }
    if (ema <= this.cfg.budgetMs) {
      this.overSince = null;
      return false;
    }
    this.overSince ??= nowMs;
    return nowMs - this.overSince >= this.cfg.sustainMs;
  }
}

/**
 * Cost of one frame for auto-tiering. Normally the synchronous work (detect + adapt + render) —
 * the wall-clock interval alone would also count a camera that itself delivers < 25 fps (low light),
 * which stepping down cannot fix. When the compositor reports that frames were skipped since the last
 * callback (rVFC `presentedFrames`), we did not keep up, so the real interval is charged instead
 * (this also catches GPU back-pressure that never shows up in CPU timings).
 */
export function frameCost(workMs: number, intervalMs: number | null, skippedFrames: number): number {
  return skippedFrames > 0 && intervalMs !== null ? Math.max(workMs, intervalMs) : workMs;
}

/** Frames the compositor presented that we never saw (0 when unknown). */
export function skippedFrames(presented: number | null, lastPresented: number | null): number {
  if (presented === null || lastPresented === null) return 0;
  const d = presented - lastPresented;
  return d > 1 ? d - 1 : 0;
}

/** Tier L detects every second frame and reuses the last landmarks in between. */
export function shouldDetect(tier: Tier, detectedLastFrame: boolean): boolean {
  return tier !== 'L' || !detectedLastFrame;
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}
