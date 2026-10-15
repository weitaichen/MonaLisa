import { describe, expect, it } from 'vitest';
import { BrushQueue } from './brushQueue';

/** a fake frame loop and clock: each add costs `cost` ms */
function rig(cost = 1) {
  let t = 0;
  const frames: (() => void)[] = [];
  const added: number[] = [];
  let changed = 0;
  const q = new BrushQueue(
    {
      add: (o) => {
        t += cost;
        added.push(o.x);
        return o.y !== 0; // y = 0 → this point changed nothing
      },
      changed: () => changed++,
      now: () => t,
      raf: (cb) => frames.push(cb),
      cancelRaf: (id) => {
        frames[id - 1] = () => undefined;
      },
    },
    6,
  );
  return {
    q,
    added,
    changes: () => changed,
    frame: () => frames.shift()?.(),
    pendingFrames: () => frames.length,
  };
}

describe('BrushQueue', () => {
  it('drains at most 6 ms of stamps per frame and keeps the rest for the next frame', () => {
    const r = rig(1);
    for (let i = 0; i < 10; i++) r.q.push({ x: i, y: 1 });
    expect(r.pendingFrames()).toBe(1); // one frame requested, not ten
    r.frame();
    expect(r.added).toEqual([0, 1, 2, 3, 4, 5]);
    expect(r.changes()).toBe(1); // one setLiquify per frame
    r.frame();
    expect(r.added).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(r.changes()).toBe(2);
    expect(r.q.size).toBe(0);
  });

  it('applies at least one point per frame even when one stamp exceeds the budget', () => {
    const r = rig(50);
    r.q.push({ x: 1, y: 1 });
    r.q.push({ x: 2, y: 1 });
    r.frame();
    expect(r.added).toEqual([1]);
    r.frame();
    expect(r.added).toEqual([1, 2]);
  });

  it('finish applies everything now; clear drops it', () => {
    const r = rig(1);
    for (let i = 0; i < 20; i++) r.q.push({ x: i, y: 1 });
    r.q.finish();
    expect(r.added).toHaveLength(20);
    expect(r.changes()).toBe(1);
    r.q.push({ x: 99, y: 1 });
    r.q.clear();
    r.frame();
    expect(r.added).toHaveLength(20);
  });

  it('a frame whose points changed nothing does not hand the field over', () => {
    const r = rig(1);
    r.q.push({ x: 1, y: 0 });
    r.frame();
    expect(r.changes()).toBe(0);
  });
});
