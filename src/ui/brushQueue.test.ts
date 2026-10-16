import { describe, expect, it } from 'vitest';
import { liquifyGrid, LiquifyModel } from '../edit/liquify';
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

describe('BrushQueue at finger up (end)', () => {
  it('a backlog that fits the deadline is applied now: end returns true and never calls done', () => {
    const r = rig(1);
    for (let i = 0; i < 3; i++) r.q.push({ x: i, y: 1 });
    let done = 0;
    expect(r.q.end(() => done++, 4)).toBe(true);
    expect(r.added).toEqual([0, 1, 2]);
    expect(r.changes()).toBe(1);
    r.frame();
    expect(done).toBe(0);
    expect(r.q.ending).toBe(false);
  });

  it('a larger backlog: the points before the deadline now, the rest one budget per frame, done once from the emptying frame', () => {
    const r = rig(1);
    for (let i = 0; i < 20; i++) r.q.push({ x: i, y: 1 });
    let done = 0;
    // the fake clock starts at 0 and each point costs 1 ms: points 0..2 end by the deadline 4, point 3 would not start
    // before 3 + 1
    expect(r.q.end(() => done++, 4)).toBe(false);
    expect(r.added).toEqual([0, 1, 2]);
    expect(r.q.ending).toBe(true);
    r.frame(); // 6 ms: 3..8
    expect(r.added).toHaveLength(9);
    expect(done).toBe(0);
    r.frame(); // 9..14
    r.frame(); // 15..19, empty: done
    expect(r.added).toEqual(Array.from({ length: 20 }, (_, i) => i)); // every point, in order
    expect(done).toBe(1);
    expect(r.q.ending).toBe(false);
    expect(r.pendingFrames()).toBe(0);
  });

  it('a deadline already passed applies nothing now', () => {
    const r = rig(1);
    r.q.push({ x: 1, y: 1 });
    expect(r.q.drainUntil(0)).toBe(false);
    expect(r.added).toEqual([]);
  });

  it('a point is not started when the last one says it would overrun the deadline (a bisecting stamp is followed by one)', () => {
    const r = rig(5);
    for (let i = 0; i < 4; i++) r.q.push({ x: i, y: 1 });
    r.frame(); // 0..1 at 5 ms each (the budget check comes after a point): 10 ms
    expect(r.added).toEqual([0, 1]);
    // at t = 10 with a 4 ms deadline: the last point took 5 ms, so nothing starts
    expect(r.q.drainUntil(14)).toBe(false);
    expect(r.added).toEqual([0, 1]);
    expect(r.q.drainUntil(16)).toBe(false);
    expect(r.added).toEqual([0, 1, 2]);
  });

  it('finish during the tail applies the rest at once and drops done; clear drops both', () => {
    const r = rig(1);
    for (let i = 0; i < 20; i++) r.q.push({ x: i, y: 1 });
    let done = 0;
    r.q.end(() => done++, 2);
    r.q.finish();
    expect(r.added).toHaveLength(20);
    expect(r.q.ending).toBe(false);
    r.frame();
    expect(done).toBe(0);
    const s = rig(1);
    for (let i = 0; i < 20; i++) s.q.push({ x: i, y: 1 });
    s.q.end(() => done++, 2);
    s.q.clear();
    s.frame();
    expect(s.added).toHaveLength(1);
    expect(done).toBe(0);
  });

  it('with the real model, a stroke committed after the tail is the stroke a full drain commits (records and field bits)', () => {
    const frame = { width: 1536, height: 2048 };
    const g = liquifyGrid(frame);
    const R = (44 / 28) * (28.7 / g.F);
    // a back-and-forth scrub of raw points: repeated pushes over one spot bisect
    const pts = Array.from({ length: 160 }, (_, i) => ({ x: 0.5 + 0.1 * Math.sin(i / 6), y: 0.45 + 0.004 * Math.cos(i / 9) }));
    const drawn = (tail: boolean) => {
      let t = 0;
      const m = new LiquifyModel(frame, { now: () => t, schedule: () => () => undefined });
      const stroke = m.begin('push', R, pts[0])!;
      const frames: (() => void)[] = [];
      // each add costs 1 ms of the fake clock: the 6 ms frames leave a backlog behind the 8 points per frame
      const q = new BrushQueue({
        add: (o) => {
          t += 1;
          return stroke.add(o);
        },
        changed: () => {},
        now: () => t,
        raf: (cb) => frames.push(cb),
        cancelRaf: () => {},
      });
      for (let i = 1; i < pts.length; i += 8) {
        for (let k = i; k < Math.min(pts.length, i + 8); k++) q.push(pts[k]);
        for (const cb of frames.splice(0)) cb();
      }
      expect(q.size, 'the scenario leaves a backlog at finger up').toBeGreaterThan(20);
      let committed = false;
      if (tail) {
        expect(q.end(() => (committed = true), t + 4)).toBe(false);
        for (let n = 0; !committed; n++) {
          if (n > 100) throw new Error('the tail never ended');
          for (const cb of frames.splice(0)) cb();
        }
      } else q.finish();
      const recs = stroke.commit(() => 'id');
      const field = Float32Array.from(m.field!.data);
      m.dispose();
      return { recs, field };
    };
    const full = drawn(false);
    const tail = drawn(true);
    expect(tail.recs.map((r) => Array.from(r.points))).toEqual(full.recs.map((r) => Array.from(r.points)));
    expect(tail.field.every((v, i) => Object.is(v, full.field[i]))).toBe(true);
  });
});
