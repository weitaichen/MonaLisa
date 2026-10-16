// The live stroke's pointer queue (push-brush spec §3.5 "Editor wiring"): pointer points are queued and one animation
// frame drains up to STAMP_FRAME_MS of stamps, then hands the field to the session once. What does not fit waits for
// the next frame, so points are never dropped. No React state is touched per point.
//
// Finger up (§6.1 "Commit ≤ 5 ms"): a fast scrub or circles can leave a backlog the frames have not drained yet (each
// bisected stamp costs several plain ones), and draining it at once blocked finger-up for as long as the backlog took.
// `end` drains only until a deadline; the rest keeps draining one STAMP_FRAME_MS per frame and the stroke commits when
// the queue is empty. The stamps are the same points in the same order, so the committed stroke is the one a full
// drain makes. Anything that needs the stroke now (an edit, 儲存, leaving the mode) still calls `finish`.
import { STAMP_FRAME_MS } from '../config/limits';

export interface BrushQueueDeps {
  /** feed one O-frame point to the live stroke; true when the field changed */
  add(o: { x: number; y: number }): boolean;
  /** the field changed during this drain (the editor calls session.setLiquify) */
  changed(): void;
  now(): number;
  raf(cb: () => void): number;
  cancelRaf(id: number): void;
}

export class BrushQueue {
  private readonly q: { x: number; y: number }[] = [];
  private frame = 0;
  private readonly deps: BrushQueueDeps;
  private readonly budgetMs: number;
  /** end's callback: runs from the frame that empties the queue */
  private onEmpty: (() => void) | null = null;
  /** ms the last applied point took (drainUntil's estimate for the next one) */
  private cost = 0;

  constructor(deps: BrushQueueDeps, budgetMs = STAMP_FRAME_MS) {
    this.deps = deps;
    this.budgetMs = budgetMs;
  }

  get size(): number {
    return this.q.length;
  }

  /** end was called and the queue has not emptied yet */
  get ending(): boolean {
    return this.onEmpty !== null;
  }

  push(o: { x: number; y: number }): void {
    this.q.push(o);
    if (!this.frame) this.frame = this.deps.raf(() => this.drain());
  }

  /** one frame's worth: at least one point, then until the budget is spent */
  drain(): void {
    this.frame = 0;
    const t0 = this.deps.now();
    let changed = false;
    while (this.q.length) {
      const t = this.deps.now();
      if (this.deps.add(this.q.shift()!)) changed = true;
      const t1 = this.deps.now();
      this.cost = t1 - t;
      if (t1 - t0 >= this.budgetMs) break;
    }
    if (changed) this.deps.changed();
    if (this.q.length) {
      if (!this.frame) this.frame = this.deps.raf(() => this.drain());
    } else if (this.onEmpty) {
      const done = this.onEmpty;
      this.onEmpty = null;
      done();
    }
  }

  /**
   * Apply queued points while each is expected to end before `deadline`: one starts only when the clock plus the cost of
   * the last applied point is before it (a point that bisects costs several plain stamps, so the next one likely does
   * too). True when the queue is empty.
   */
  drainUntil(deadline: number): boolean {
    let changed = false;
    while (this.q.length) {
      const t = this.deps.now();
      if (t + this.cost >= deadline) break;
      if (this.deps.add(this.q.shift()!)) changed = true;
      this.cost = this.deps.now() - t;
    }
    if (changed) this.deps.changed();
    return this.q.length === 0;
  }

  /**
   * Finger up: drainUntil(deadline). True when the queue is then empty (the caller commits now; `done` is not called).
   * Otherwise false: the frames keep draining and `done` runs from the one that empties the queue. A later finish or
   * clear drops `done` (that caller commits or cancels itself).
   */
  end(done: () => void, deadline: number): boolean {
    if (this.drainUntil(deadline)) return true;
    this.onEmpty = done;
    if (!this.frame) this.frame = this.deps.raf(() => this.drain());
    return false;
  }

  /** apply everything still queued now (before a commit) */
  finish(): void {
    this.cancelFrame();
    this.onEmpty = null;
    let changed = false;
    while (this.q.length) if (this.deps.add(this.q.shift()!)) changed = true;
    if (changed) this.deps.changed();
  }

  /** drop everything queued (a cancelled stroke) */
  clear(): void {
    this.cancelFrame();
    this.onEmpty = null;
    this.q.length = 0;
  }

  private cancelFrame(): void {
    if (this.frame) this.deps.cancelRaf(this.frame);
    this.frame = 0;
  }
}
