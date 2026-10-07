// Editor face-detection / export bookkeeping (spec §7.2.4), kept pure so it can be unit-tested without a DOM.
import type { Face, TrackerState } from '../types';

/**
 * Create the still session (its constructor runs the one synchronous face detection) and decide whether its
 * "no face" is a real answer. unsure: the tracker could not answer, because it was unhealthy before the call,
 * or the call itself found it unusable (tracker.ts retires a lost instance and reports 'lost' synchronously
 * before returning null), or the detect call threw (faceKnown false).
 */
export function detectSession<S extends { face: Face | null; faceKnown: boolean }>(
  hasTracker: boolean,
  healthy: () => boolean,
  create: () => S,
): { s: S; unsure: boolean } {
  const before = healthy();
  const s = create();
  const unsure = hasTracker && !s.face && (!before || !healthy() || !s.faceKnown);
  return { s, unsure };
}

/** non-answers in a row before the editor stops re-detecting; = tracker ESCALATE_AFTER, so repeated throws reach its instance replacement */
export const MAX_REDETECTS = 3;

/**
 * When to detect again on the same photo. Only non-answers spend the budget (a definite answer clears
 * `unsure`, which stops the retries by itself); a tracker recovery (lost / failed → ok) refills it. Bounded
 * because the tracker's own backoff and retry limits bound how often it recovers.
 */
export class RedetectBudget {
  private used = 0;
  constructor(private health: TrackerState) {}

  /** true → detect again now (call on every change of the binding or the tracker health) */
  next(unsure: boolean, health: TrackerState): boolean {
    if (health !== this.health) {
      if (health === 'ok') this.used = 0;
      this.health = health;
    }
    if (!unsure || health !== 'ok' || this.used >= MAX_REDETECTS) return false;
    this.used++;
    return true;
  }
}

/**
 * Run an export on `s`; when it fails because `s` was replaced meanwhile (a re-detect or an engine recovery
 * disposed it mid-export), run it again on the replacement, at most `retries` times. `replacement` returns
 * the session that took over from the failed one, or null when the failure stands.
 */
export async function exportOnLatest<S, T>(
  s: S,
  run: (s: S) => Promise<T>,
  replacement: (failed: S) => S | null,
  retries = 2,
): Promise<{ s: S; result: T }> {
  for (let left = retries; ; left--) {
    try {
      return { s, result: await run(s) };
    } catch (e) {
      const next = left > 0 ? replacement(s) : null;
      if (!next) throw e;
      s = next;
    }
  }
}
