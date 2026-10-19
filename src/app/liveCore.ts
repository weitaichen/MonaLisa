// Pure pieces of the live loop (no DOM, no GL) so they can be unit-tested with fake timers:
// face-weight easing, time-based EMA, the auto-tier state machine and per-frame scheduling decisions.
import { LIVE_MAX_DETECT_EVERY, LIVE_MIN_FPS } from '../config/limits';
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

/** the cadence's hysteresis (camera per-person spec §6.4): a k that rises applies after it held this long… */
export const CADENCE_UP_MS = 500;
/** …one that falls after this long */
export const CADENCE_DOWN_MS = 1500;

/**
 * Detect every k-th frame with ≥ 2 faces (camera per-person spec §6.4, K6): the fewest skipped detections that keep the
 * average frame time `(D + R + (k − 1) T) / k` within `T_min = max(1000 / LIVE_MIN_FPS, 1.25 T)`, i.e.
 * `k = clamp(⌈(D + R − T) / (T_min − T)⌉, 1, LIVE_MAX_DETECT_EVERY)`. D is the detection cost per call, R the render
 * cost, T the camera's own frame interval (ms). A non-finite input → 1.
 */
export function detectEvery(detectMs: number, renderMs: number, frameMs: number): number {
  if (!Number.isFinite(detectMs) || !Number.isFinite(renderMs) || !Number.isFinite(frameMs)) return 1;
  const tMin = Math.max(1000 / LIVE_MIN_FPS, 1.25 * frameMs);
  if (tMin <= frameMs) return 1;
  const k = Math.ceil((detectMs + renderMs - frameMs) / (tMin - frameMs));
  return Math.min(LIVE_MAX_DETECT_EVERY, Math.max(1, k));
}

/**
 * The cadence with its hysteresis (§6.4): feed the EMAs once per frame; a candidate k different from the current one
 * applies once it held CADENCE_UP_MS (rising) or CADENCE_DOWN_MS (falling). The timer restarts when the candidate's
 * direction changes and stops when the candidate equals k again; a null D or R (nothing measured yet) keeps k.
 */
export class DetectCadence {
  private cur = 1;
  private since: number | null = null;
  private dir = 0;

  get k(): number {
    return this.cur;
  }

  update(nowMs: number, detectMs: number | null, renderMs: number | null, frameMs: number): number {
    const next = detectMs === null || renderMs === null ? this.cur : detectEvery(detectMs, renderMs, frameMs);
    if (next === this.cur) {
      this.since = null;
      this.dir = 0;
      return this.cur;
    }
    const dir = next > this.cur ? 1 : -1;
    if (this.since === null || dir !== this.dir) {
      this.since = nowMs;
      this.dir = dir;
    }
    if (nowMs - this.since >= (dir > 0 ? CADENCE_UP_MS : CADENCE_DOWN_MS)) {
      this.cur = next;
      this.since = null;
      this.dir = 0;
    }
    return this.cur;
  }

  /** resetSession (§6.4): k = 1, nothing pending */
  reset(): void {
    this.cur = 1;
    this.since = null;
    this.dir = 0;
  }
}

/**
 * Frames per detection (§6.4): one face or none → every frame, as v0.5 (A1; tier L every second, `shouldDetect`);
 * ≥ 2 faces → the cadence's k, at least 2 on tier L.
 */
export function effectiveEvery(k: number, tier: Tier, shownFaces: number): number {
  const floor = tier === 'L' ? 2 : 1;
  return shownFaces <= 1 ? floor : Math.max(k, floor);
}

/**
 * The auto-tier sample of a detecting frame (§6.4): `R + D / k`, the detection amortized over the k frames it serves
 * (the frame it drops is the detection's, which a lower render tier cannot fix). k = 1 → R + D.
 */
export function cadenceSample(renderMs: number, detectMs: number, every: number): number {
  return renderMs + detectMs / Math.max(1, every);
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}
