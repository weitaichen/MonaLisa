// The live stroke's pointer queue (push-brush spec §3.5 "Editor wiring"): pointer points are queued and one animation
// frame drains up to STAMP_FRAME_MS of stamps, then hands the field to the session once. What does not fit waits for
// the next frame, so points are never dropped. No React state is touched per point.
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

  constructor(deps: BrushQueueDeps, budgetMs = STAMP_FRAME_MS) {
    this.deps = deps;
    this.budgetMs = budgetMs;
  }

  get size(): number {
    return this.q.length;
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
      if (this.deps.add(this.q.shift()!)) changed = true;
      if (this.deps.now() - t0 >= this.budgetMs) break;
    }
    if (changed) this.deps.changed();
    if (this.q.length && !this.frame) this.frame = this.deps.raf(() => this.drain());
  }

  /** apply everything still queued now (before a commit) */
  finish(): void {
    this.cancelFrame();
    let changed = false;
    while (this.q.length) if (this.deps.add(this.q.shift()!)) changed = true;
    if (changed) this.deps.changed();
  }

  /** drop everything queued (a cancelled stroke) */
  clear(): void {
    this.cancelFrame();
    this.q.length = 0;
  }

  private cancelFrame(): void {
    if (this.frame) this.deps.cancelRaf(this.frame);
    this.frame = 0;
  }
}
