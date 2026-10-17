// 推臉筆 (push-brush spec §8.1): resampling, the stamp operators, the per-stamp fold guard, determinism, patches,
// caps, sanitize. Distances are in S units (fractions of the frame's short edge). Content travel is measured with an
// inverse of the backward map along the stroke line (bisection; the app itself never inverts the field).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fieldAt, warpImage } from '../body/cpuWarp';
import { fieldMinJacobian, fieldMinJacobianRect } from '../body/field';
import {
  GUARD_STEPS,
  LIQUIFY_MIN_DET,
  LIQUIFY_SYNC_WORK,
  LIQUIFY_WORK_CAP,
  MAX_STROKES,
  PATCH_TILE,
  PUSH_GAIN,
  R_MAX,
} from '../config/limits';
import type { LiquifyField, LiquifyFrame, Stroke } from '../types';
import {
  brushRadius,
  LiquifyModel,
  liquifyGrid,
  makeStrokeId,
  rMin,
  sanitizeStrokes,
  StrokeBuilder,
  strokeWork,
  type LiveStroke,
} from './liquify';
import { prng, straightStroke, strokesCap, strokesS30 } from './strokeFixtures';

/** 3:4, grid 384 × 512: the spec's measuring frame */
const FRAME: LiquifyFrame = { width: 1536, height: 2048 };
const G = liquifyGrid(FRAME);
/** 中 / 大 / 小 at zoom 1 (28.7 texels for 中) */
const RM = 28.7 / G.F;
const RL = RM * (44 / 28);
const RS = RM * (16 / 28);

const toO = (sx: number, sy: number) => ({ x: sx / G.ax, y: sy / G.ay });
let ids = 0;
const newId = () => `t${ids++}`;

/** a fresh model whose clock and scheduler the test drives */
function model(frame = FRAME, opts: { patchBudget?: number; syncWork?: number } = {}) {
  let t = 0;
  let settled = 0;
  const queue: (() => void)[] = [];
  const m = new LiquifyModel(frame, {
    now: () => t,
    onSettled: () => settled++,
    schedule: (cb) => {
      queue.push(cb);
      return () => queue.splice(queue.indexOf(cb), 1);
    },
    ...opts,
  });
  return {
    m,
    advance: (ms: number) => (t += ms),
    settled: () => settled,
    /** run scheduled slices until none is left */
    flush: () => {
      for (let i = 0; queue.length && i < 10_000; i++) queue.shift()!();
    },
  };
}

/** a live drag in S units: from (sx, sy) by (dx, dy), fed as `steps` raw points */
function drag(m: LiquifyModel, kind: Stroke['kind'], R: number, sx: number, sy: number, dx: number, dy: number, steps = 60): { recs: Stroke[]; live: LiveStroke } {
  const live = m.begin(kind, R, toO(sx, sy))!;
  expect(live).not.toBeNull();
  for (let k = 1; k <= steps; k++) live.add(toO(sx + (dx * k) / steps, sy + (dy * k) / steps));
  return { recs: live.commit(newId), live };
}

/** where content that sat at source (cx, cy) is shown now, along the line y = cy (S units) */
function contentX(m: LiquifyModel, cx: number, cy: number, span: number): number {
  const M = (x: number) => m.backward(toO(x, cy)).x * G.ax;
  let lo = cx - span;
  let hi = cx + span;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (M(mid) < cx) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

const maxLen = (f: LiquifyField | null) => {
  if (!f) return 0;
  let m = 0;
  for (let i = 0; i < f.data.length; i += 2) m = Math.max(m, Math.hypot(f.data[i], f.data[i + 1]));
  return m;
};

/** bit-for-bit equality of two Float32Arrays (expect().toEqual walks 400 k elements slowly) */
const same = (a: Float32Array, b: Float32Array) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

const f16 = (Math as { f16round?: (x: number) => number }).f16round ?? ((x: number) => x);
const f16Field = (f: LiquifyField): LiquifyField => ({ ...f, data: f.data.map((v) => f16(v)) });

/** tests/fixtures/strokes_*.json (PB §8.4): { frame, strokes } with the points as plain arrays */
const fixturePath = (name: string) => resolve(import.meta.dirname, '../../tests/fixtures', name);
const fixtureJson = (recs: Stroke[]) => `${JSON.stringify({ frame: FRAME, strokes: recs.map((r) => ({ ...r, points: Array.from(r.points) })) })}\n`;
const readFixture = (name: string): Stroke[] => {
  const raw = JSON.parse(readFileSync(fixturePath(name), 'utf8')) as { frame: LiquifyFrame; strokes: unknown };
  return sanitizeStrokes(raw.strokes, raw.frame);
};

describe('StrokeBuilder: resampling (§3.4)', () => {
  const gaps = (recs: Stroke[], frame: LiquifyFrame) => {
    const g = liquifyGrid(frame);
    const out: number[] = [];
    for (const r of recs)
      for (let i = 1; i < r.points.length / 2; i++)
        out.push(Math.hypot((r.points[i * 2] - r.points[i * 2 - 2]) * g.ax, (r.points[i * 2 + 1] - r.points[i * 2 - 1]) * g.ay));
    return out;
  };

  it('emits a point every radius/4 in S units; the last gap is in [radius/8, radius/4)', () => {
    const sb = new StrokeBuilder('push', RM, FRAME, toO(0.3, 0.4));
    sb.add(toO(0.3 + 1.1 * RM, 0.4 + 0.5 * RM));
    sb.add(toO(0.3 + 2.3 * RM, 0.4 - 0.2 * RM));
    const [rec] = sb.finish(newId);
    const gs = gaps([rec], FRAME);
    for (const d of gs.slice(0, -1)) expect(Math.abs(d / (RM / 4) - 1)).toBeLessThan(1e-6);
    expect(gs[gs.length - 1]).toBeGreaterThanOrEqual(RM / 8 - 1e-7);
    expect(gs[gs.length - 1]).toBeLessThan((RM / 4) * (1 + 1e-6));
    expect(rec.strength).toBe(PUSH_GAIN);
    expect(rec.radius).toBe(RM);
  });

  it('is speed independent: the same straight path fed as 3 or 300 raw points gives the same records', () => {
    const run = (n: number) => {
      const sb = new StrokeBuilder('push', RM, FRAME, toO(0.2, 0.5));
      for (let k = 1; k <= n; k++) sb.add(toO(0.2 + (3 * RM * k) / n, 0.5 + (RM * k) / n));
      return sb.finish(newId)[0].points;
    };
    const a = run(3);
    const b = run(300);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) expect(Math.abs(a[i] - b[i])).toBeLessThan(1e-6);
  });

  it('a tap emits no second point and so no record', () => {
    const sb = new StrokeBuilder('push', RM, FRAME, toO(0.3, 0.3));
    sb.add(toO(0.3 + RM / 16, 0.3));
    expect(sb.finish(newId)).toEqual([]);
  });

  it('splits 700 points into 3 records whose continuations repeat the last point', () => {
    const sb = new StrokeBuilder('push', 0.02, FRAME, toO(0.05, 0.5));
    // 699 gaps of r/4 = 0.005: a straight line of 3.495 S units does not fit, so zig-zag within the frame
    let x = 0.05;
    let dir = 1;
    let y = 0.5;
    while (sb.count < 700) {
      x += dir * 0.0125;
      if (x > 0.7 || x < 0.05) {
        dir = -dir;
        y += 0.01;
      }
      sb.add(toO(x, y));
    }
    sb.stop(700);
    const recs = sb.records(newId, PUSH_GAIN);
    expect(recs.map((r) => r.points.length / 2)).toEqual([256, 256, 190]);
    expect(recs[1].points.slice(0, 2)).toEqual(recs[0].points.slice(-2));
    expect(recs[2].points.slice(0, 2)).toEqual(recs[1].points.slice(-2));
  });

  it('works in S units: a circle stays a circle on 3:4 and 16:9 frames', () => {
    for (const frame of [FRAME, { width: 1920, height: 1080 }]) {
      const g = liquifyGrid(frame);
      const sb = new StrokeBuilder('push', 0.05, frame, { x: (0.4 + 0.1) / g.ax, y: 0.4 / g.ay });
      for (let k = 1; k <= 400; k++) {
        const a = (k / 400) * Math.PI * 2;
        sb.add({ x: (0.4 + 0.1 * Math.cos(a)) / g.ax, y: (0.4 + 0.1 * Math.sin(a)) / g.ay });
      }
      const [rec] = sb.finish(newId);
      for (let i = 0; i < rec.points.length / 2; i++) {
        const r = Math.hypot(rec.points[i * 2] * g.ax - 0.4, rec.points[i * 2 + 1] * g.ay - 0.4);
        expect(Math.abs(r - 0.1)).toBeLessThan(0.002); // chords of a 0.1 circle at 0.0125 spacing
      }
    }
  });

  it('grids follow the frame: 3:4 → 384 × 512, a 4:1 panorama → 512 × 128 with rMin = 4/128', () => {
    expect([G.w, G.h, G.F]).toEqual([384, 512, 384]);
    const pano = { width: 4000, height: 1000 };
    const g = liquifyGrid(pano);
    expect([g.w, g.h]).toEqual([512, 128]);
    expect(rMin(pano)).toBeCloseTo(4 / 128, 12);
  });

  it('brushRadius: two O points 1 brush apart → S units, clamped, with the ring scale of the clamp', () => {
    const o = toO(0.5, 0.5);
    expect(brushRadius(o, toO(0.5 + RM, 0.5), FRAME).radius).toBeCloseTo(RM, 9);
    expect(brushRadius(o, toO(0.5 + RM, 0.5), FRAME).ringScale).toBeCloseTo(1, 9);
    const deep = brushRadius(o, toO(0.5 + rMin(FRAME) / 5, 0.5), FRAME); // zoomed far in
    expect(deep.radius).toBe(rMin(FRAME));
    expect(deep.ringScale).toBeCloseTo(5, 9);
    expect(brushRadius(o, toO(0.5, 0.5 + 1), FRAME).radius).toBe(R_MAX);
  });

  it('clamps raw points to [−1, 2]²', () => {
    const sb = new StrokeBuilder('push', 0.22, FRAME, { x: -5, y: 0.5 });
    sb.add({ x: 9, y: 0.5 });
    const [rec] = sb.finish(newId);
    expect(rec.points[0]).toBe(-1);
    expect(rec.points[rec.points.length - 2]).toBe(2);
  });
});

describe('push stamp (§4.2)', () => {
  it('one stamp on an empty field is toUV(−g·w(|X − c|)·Δ) inside the disc and exactly 0 outside', () => {
    const { m } = model();
    // the stamp centre and Δ come from the Float32 points, as the model stores them
    const c = { x: Math.fround(0.4 / G.ax) * G.ax, y: Math.fround(0.5 / G.ay) * G.ay };
    const live = m.begin('push', RM, toO(0.4, 0.5))!;
    live.add(toO(0.4 + 1.5 * (RM / 4), 0.5)); // exactly one stamp: Δ = (R/4, 0)
    const dx = Math.fround((0.4 + RM / 4) / G.ax) * G.ax - c.x;
    const f = m.field!;
    const R2 = RM * RM;
    let inside = 0;
    let outsideNonZero = 0;
    let worst = 0;
    for (let j = 0; j < f.height; j++)
      for (let i = 0; i < f.width; i++) {
        const X = ((i + 0.5) / f.width) * G.ax - c.x;
        const Y = ((j + 0.5) / f.height) * G.ay - c.y;
        const d2 = X * X + Y * Y;
        const k = (j * f.width + i) * 2;
        if (d2 >= R2) {
          if (f.data[k] !== 0 || f.data[k + 1] !== 0) outsideNonZero++;
          continue;
        }
        inside++;
        const q = 1 - d2 / R2;
        worst = Math.max(worst, Math.abs(f.data[k] - (-PUSH_GAIN * q * q * q * dx) / G.ax), Math.abs(f.data[k + 1]));
      }
    expect(inside).toBeGreaterThan(2000);
    expect(outsideNonZero).toBe(0);
    expect(worst).toBeLessThan(1e-9);
    live.cancel();
    expect(m.field).toBeNull();
  });

  it('a stroke touches exactly the texels of its predicted boxes (base work = touched-box texels)', () => {
    const { m } = model();
    const { recs } = drag(m, 'push', RM, 0.3, 0.6, 0.8 * RM, 0.3 * RM);
    const f = m.field!;
    const P = recs[0].points;
    let nonZero = 0;
    for (let j = 0; j < f.height; j++)
      for (let i = 0; i < f.width; i++) {
        const k = (j * f.width + i) * 2;
        if (f.data[k] === 0 && f.data[k + 1] === 0) continue;
        nonZero++;
        // push stamp c = p[i − 1]: every touched texel lies within R of a stamp centre
        const X = ((i + 0.5) / f.width) * G.ax;
        const Y = ((j + 0.5) / f.height) * G.ay;
        let near = Infinity;
        for (let c = 0; c < P.length / 2 - 1; c++) near = Math.min(near, Math.hypot(X - P[c * 2] * G.ax, Y - P[c * 2 + 1] * G.ay));
        expect(near).toBeLessThan(RM);
      }
    expect(nonZero).toBeGreaterThan(0);
    expect(nonZero).toBeLessThanOrEqual(strokeWork(recs[0], FRAME));
  });

  it('content at the start of a 0.5 R drag moves 0.6–0.8× the drag', () => {
    const { m } = model();
    drag(m, 'push', RM, 0.375, 0.5, 0.5 * RM, 0);
    const travel = (contentX(m, 0.375, 0.5, 3 * RM) - 0.375) / (0.5 * RM);
    expect(travel).toBeGreaterThan(0.6);
    expect(travel).toBeLessThan(0.8);
  });

  it('a 6 R straight drag moves content by at most 2 R, and a single straight drag never bisects', () => {
    const { m } = model();
    const { recs } = drag(m, 'push', RM, 0.15, 0.5, 6 * RM, 0, 300);
    const travel = (contentX(m, 0.15, 0.5, 8 * RM) - 0.15) / RM;
    expect(travel).toBeGreaterThan(1);
    expect(travel).toBeLessThanOrEqual(2);
    expect(m.work).toBe(recs.reduce((s, r) => s + strokeWork(r, FRAME), 0));
    expect(fieldMinJacobian(m.field!)).toBeGreaterThanOrEqual(LIQUIFY_MIN_DET);
  });
});

describe('restore stamp (§4.2)', () => {
  it('a 中 push then 大 restore passes: ≤ 12 % after one, ≤ 3 % after two, exactly 0 within 10', () => {
    const { m } = model();
    const cx = 0.3;
    const cy = 0.5;
    drag(m, 'push', RM, cx, cy, RM, 0);
    const m0 = maxLen(m.field);
    const left: number[] = [];
    let zeroAfter = -1;
    for (let p = 1; p <= 10 && zeroAfter < 0; p++) {
      drag(m, 'restore', RL, cx - 0.5 * RL, cy, RM + RL, 0, 80);
      left.push(maxLen(m.field) / m0);
      if (m.field!.data.every((v) => v === 0)) zeroAfter = p;
    }
    expect(left[0]).toBeLessThanOrEqual(0.12);
    expect(left[1]).toBeLessThanOrEqual(0.03);
    expect(zeroAfter).toBeGreaterThan(0);
    // then the area is exactly the slider-only image: the CPU warp with the field equals the one without it, bit for bit
    const img = Uint8ClampedArray.from({ length: 96 * 128 * 4 }, (_, i) => (i * 37) % 251);
    expect(Array.from(warpImage(img, 96, 128, 4, m.field))).toEqual(Array.from(warpImage(img, 96, 128, 4, null)));
  });

  it('a restore over an untouched area is a no-op gesture: no record', () => {
    const { m } = model();
    drag(m, 'push', RM, 0.2, 0.2, RM, 0);
    const before = m.field!.data.slice();
    const { recs } = drag(m, 'restore', RM, 0.6, 0.9, RM, 0);
    expect(recs).toEqual([]);
    expect(m.count).toBe(1);
    expect(same(m.field!.data, before)).toBe(true);
  });

  it('a restore on a photo without strokes leaves nothing allocated', () => {
    const { m } = model();
    const { recs } = drag(m, 'restore', RM, 0.6, 0.9, RM, 0);
    expect(recs).toEqual([]);
    expect(m.field).toBeNull();
  });
});

describe('fold guard (§4.3)', () => {
  it('fuzz: 200 random push / restore scribbles, circles and scrubs never fold and stay finite', () => {
    const rnd = prng(7);
    const frame = { width: 600, height: 800 };
    const g = liquifyGrid(frame);
    const sizes = [16, 28, 44].map((px) => (px / 28) * (28.7 / g.F));
    for (let s = 0; s < 200; s++) {
      const { m } = model(frame);
      const strokes = 1 + Math.floor(rnd() * 3);
      for (let k = 0; k < strokes; k++) {
        const kind = rnd() < 0.7 ? 'push' : 'restore';
        const R = sizes[Math.floor(rnd() * 3)];
        const cx = 0.2 + 0.4 * rnd();
        const cy = 0.2 + 0.6 * rnd();
        const live = m.begin(kind, R, { x: cx / g.ax, y: cy / g.ay });
        if (!live) break;
        const shape = Math.floor(rnd() * 3);
        // texel box of everything this gesture can reach (the stamps change nothing outside it)
        const box = { x0: cx - 3 * R, x1: cx + 3 * R, y0: cy - 2 * R, y1: cy + 2 * R };
        for (let i = 1; i <= 24; i++) {
          const t = i / 24;
          const p =
            shape === 0
              ? { x: cx + (rnd() - 0.5) * 2 * R, y: cy + (rnd() - 0.5) * 2 * R } // scribble, within ±R
              : shape === 1
                ? { x: cx + R * Math.cos(t * 4 * Math.PI) - R, y: cy + R * Math.sin(t * 4 * Math.PI) } // two circles
                : { x: cx + R * Math.sin(t * 6 * Math.PI), y: cy }; // back-and-forth scrub
          live.add({ x: p.x / g.ax, y: p.y / g.ay });
          if (!m.field) continue;
          const i0 = Math.floor((box.x0 / g.ax) * g.w) - 2;
          const i1 = Math.ceil((box.x1 / g.ax) * g.w) + 2;
          const j0 = Math.floor((box.y0 / g.ay) * g.h) - 2;
          const j1 = Math.ceil((box.y1 / g.ay) * g.h) + 2;
          expect(fieldMinJacobianRect(m.field, i0, j0, i1, j1)).toBeGreaterThanOrEqual(LIQUIFY_MIN_DET - 1e-6);
        }
        live.commit(newId);
      }
      if (m.field) {
        expect(fieldMinJacobian(m.field)).toBeGreaterThanOrEqual(LIQUIFY_MIN_DET - 1e-6);
        expect(m.field.data.every(Number.isFinite)).toBe(true);
      }
    }
  }, 120_000);

  it('a 小 restore line across a 4 R 大 push is guarded too, and the f16 upload keeps min det > 0.1', () => {
    const { m } = model();
    drag(m, 'push', RL, 0.2, 0.5, 4 * RL, 0, 200);
    drag(m, 'restore', RS, 0.2 + 2 * RL, 0.5 - 1.5 * RL, 0, 3 * RL, 120);
    expect(fieldMinJacobian(m.field!)).toBeGreaterThanOrEqual(LIQUIFY_MIN_DET - 1e-6);
    expect(fieldMinJacobian(f16Field(m.field!))).toBeGreaterThan(0.1);
  });

  it('ten 1 R pushes from one start: travel never decreases, stops growing, and the brush resists', () => {
    const { m } = model();
    const cx = 0.3;
    const cy = 0.5;
    const travel: number[] = [];
    const states: string[] = [];
    for (let k = 0; k < 10; k++) {
      const live = m.begin('push', RM, toO(cx, cy))!;
      for (let s = 1; s <= 40; s++) live.add(toO(cx + (RM * s) / 40, cy));
      states.push(live.state);
      live.commit(newId);
      travel.push((contentX(m, cx, cy, 4 * RM) - cx) / RM);
    }
    for (let k = 1; k < 10; k++) expect(travel[k]).toBeGreaterThanOrEqual(travel[k - 1] - 1e-9);
    expect(travel[9]).toBeLessThanOrEqual(1);
    expect(travel[9] - travel[4]).toBeLessThan(0.01);
    expect(states[9]).toBe('resisting');
    expect(fieldMinJacobian(f16Field(m.field!))).toBeGreaterThan(0.1);
  });
});

describe('determinism, patches, sync (§3.5)', () => {
  const draw = (m: LiquifyModel) => {
    const all: Stroke[] = [];
    all.push(...drag(m, 'push', RM, 0.3, 0.4, 2 * RM, 0.5 * RM).recs);
    all.push(...drag(m, 'push', RL, 0.5, 0.6, -RL, 2 * RL).recs);
    all.push(...drag(m, 'restore', RS, 0.35, 0.35, RM, RM).recs);
    all.push(...drag(m, 'push', RM, 0.6, 0.3, 0, 3 * RM).recs);
    return all;
  };

  it('live drawing, sync of the same records into a fresh model, and revert + re-apply are bit-identical', () => {
    const a = model();
    const recs = draw(a.m);
    const b = model();
    expect(b.m.sync(recs)).toEqual({ changed: true, pending: false });
    expect(same(b.m.field!.data, a.m.field!.data)).toBe(true);
    const live = a.m.field!.data.slice();
    expect(a.m.sync(recs.slice(0, 2))).toEqual({ changed: true, pending: false });
    const c = model();
    c.m.sync(recs.slice(0, 2));
    expect(same(a.m.field!.data, c.m.field!.data)).toBe(true); // revert by patches = rebuild of the prefix
    a.m.sync(recs);
    expect(same(a.m.field!.data, live)).toBe(true);
  });

  it('after patch eviction sync falls back to a rebuild with the same result', () => {
    const a = model(FRAME, { patchBudget: 8 * 1024 }); // one tile: every older patch is evicted
    const recs = draw(a.m);
    expect(a.m.patchBytes).toBeLessThanOrEqual(8 * 1024 + PATCH_TILE * PATCH_TILE * 8);
    a.m.sync(recs.slice(0, 1));
    const c = model();
    c.m.sync(recs.slice(0, 1));
    expect(same(a.m.field!.data, c.m.field!.data)).toBe(true);
  });

  it("a live gesture's patch is kept past the budget during the grace and evicted after it", () => {
    const a = model(FRAME, { patchBudget: 1 });
    const live = a.m.begin('push', RL, toO(0.3, 0.5))!;
    live.add(toO(0.3 + RL, 0.5));
    expect(a.m.patchBytes).toBeGreaterThan(0);
    a.advance(250);
    live.add(toO(0.3 + 2 * RL, 0.5)); // a new tile is patched → the budget is enforced again
    expect(a.m.patchBytes).toBe(0);
    live.cancel(); // falls back to a rebuild of nothing: the field is gone
    expect(a.m.field).toBeNull();
  });

  it('cancel restores the exact pre-gesture field and makes no record', () => {
    const { m } = model();
    drag(m, 'push', RM, 0.3, 0.4, RM, 0);
    const before = m.field!.data.slice();
    const live = m.begin('push', RL, toO(0.4, 0.5))!;
    live.add(toO(0.4 + RL, 0.5));
    live.cancel();
    expect(same(m.field!.data, before)).toBe(true);
    expect(m.count).toBe(1);
  });

  it('sync([]) frees everything; ↶ afterwards replays to the same bits', () => {
    const a = model();
    const recs = draw(a.m);
    const bits = a.m.field!.data.slice();
    expect(a.m.sync([])).toEqual({ changed: true, pending: false });
    expect(a.m.field).toBeNull();
    expect(a.m.patchBytes).toBe(0);
    a.m.sync(recs);
    expect(same(a.m.field!.data, bits)).toBe(true);
  });

  it('a rebuild above the sync work runs in slices; a new sync restarts it; the result equals a synchronous one', () => {
    const recs = strokesS30(FRAME);
    const a = model(FRAME, { syncWork: 20_000 });
    expect(a.m.sync(recs)).toEqual({ changed: true, pending: true });
    expect(a.m.pending).toBe(true);
    expect(a.m.field).toBeNull(); // nothing half-built is ever shown
    expect(a.m.begin('push', RM, toO(0.5, 0.5))).toBeNull(); // brush input is refused
    expect(a.m.sync(recs.slice(0, 20))).toEqual({ changed: true, pending: true }); // restarted
    a.flush();
    expect(a.m.pending).toBe(false);
    expect(a.settled()).toBe(1);
    const b = model();
    b.m.sync(recs.slice(0, 20));
    expect(same(a.m.field!.data, b.m.field!.data)).toBe(true);
  });

  it('settle() finishes a pending rebuild at once, with the same bits', () => {
    const recs = strokesS30(FRAME);
    const a = model(FRAME, { syncWork: 20_000 });
    a.m.sync(recs);
    a.m.settle();
    expect(a.m.pending).toBe(false);
    a.flush(); // the cancelled slice does nothing
    expect(a.settled()).toBe(0);
    const b = model();
    b.m.sync(recs);
    expect(same(a.m.field!.data, b.m.field!.data)).toBe(true);
  });

  it('S30 replays synchronously; SCAP (at the work cap) goes to slices (records read from tests/fixtures)', () => {
    const s30 = readFixture('strokes_s30.json');
    expect(s30.length).toBeGreaterThanOrEqual(30);
    expect(model().m.sync(s30).pending).toBe(false);
    const cap = readFixture('strokes_cap.json');
    const w = cap.reduce((s, r) => s + strokeWork(r, FRAME), 0);
    expect(w).toBeGreaterThan(LIQUIFY_SYNC_WORK);
    expect(w).toBeLessThanOrEqual(LIQUIFY_WORK_CAP);
    const c = model();
    expect(c.m.sync(cap).pending).toBe(true);
    c.flush();
    expect(c.m.pending).toBe(false);
    expect(c.m.count).toBe(cap.length);
  }, 60_000);
});

describe('caps and work (§3.6)', () => {
  it('begin returns null at MAX_STROKES records and at the work cap', () => {
    const { m } = model();
    const recs: Stroke[] = [];
    for (let k = 0; k < MAX_STROKES; k++)
      recs.push(...straightStroke(FRAME, 'push', RS, toO(0.1 + (k % 10) * 0.05, 0.1 + Math.floor(k / 10) * 0.07), toO(0.12 + (k % 10) * 0.05, 0.1 + Math.floor(k / 10) * 0.07), `c${k}`));
    m.sync(recs);
    expect(m.count).toBe(MAX_STROKES);
    expect(m.begin('push', RM, toO(0.5, 0.5))).toBeNull();
    const one = straightStroke(FRAME, 'push', RM, toO(0.3, 0.3), toO(0.3 + 2 * RM, 0.3), 'w');
    const c = new LiquifyModel(FRAME, { workCap: strokeWork(one[0], FRAME) });
    c.sync(one);
    expect(c.begin('push', RM, toO(0.6, 0.6))).toBeNull();
  });

  it('a gesture crossing the work cap is capped and commits only the stamps that fit', () => {
    const c = new LiquifyModel(FRAME, { workCap: 60_000, now: () => 0 });
    const live = c.begin('push', RM, toO(0.2, 0.5))!;
    for (let k = 1; k <= 200 && live.state !== 'capped'; k++) live.add(toO(0.2 + (k * RM) / 8, 0.5));
    expect(live.state).toBe('capped');
    expect(live.add(toO(0.9, 0.5))).toBe(false);
    const recs = live.commit(newId);
    expect(recs).toHaveLength(1);
    expect(c.work).toBeLessThanOrEqual(60_000);
    // the refused stamp would have crossed the cap: the room left is less than one stamp box
    expect(c.work + strokeWork({ ...recs[0], points: recs[0].points.slice(-4) }, FRAME)).toBeGreaterThan(60_000 - 3500);
  });

  it('a gesture crossing the record cap is capped and commits only the stamps before it', () => {
    const { m } = model();
    const recs: Stroke[] = [];
    for (let k = 0; k < MAX_STROKES - 1; k++)
      recs.push(...straightStroke(FRAME, 'push', RS, toO(0.1 + (k % 10) * 0.05, 0.1 + Math.floor(k / 10) * 0.07), toO(0.12 + (k % 10) * 0.05, 0.1 + Math.floor(k / 10) * 0.07), `c${k}`));
    m.sync(recs);
    // a tiny radius and a long path: more than 255 points, i.e. a second record → over the cap
    const r = rMin(FRAME);
    const live = m.begin('push', r, toO(0.1, 0.95))!;
    for (let k = 1; k <= 300 && live.state !== 'capped'; k++) live.add(toO(0.1 + k * (r / 4) * 1.01, 0.95));
    expect(live.state).toBe('capped');
    const out = live.commit(newId);
    expect(out).toHaveLength(1);
    expect(out[0].points.length / 2).toBe(256);
    expect(m.count).toBe(MAX_STROKES);
  });

  it('actual work ≥ base work, and equals base × (1 + bisection steps) per stamp', () => {
    const { m } = model();
    const cx = 0.3;
    for (let k = 0; k < 4; k++) {
      const live = m.begin('push', RM, toO(cx, 0.5))!;
      for (let s = 1; s <= 40; s++) live.add(toO(cx + (RM * s) / 40, 0.5));
      live.commit(newId);
    }
    const recs = sanitizeStrokes(m.records, FRAME);
    const base = recs.reduce((s, r) => s + strokeWork(r, FRAME), 0);
    expect(m.work).toBeGreaterThan(base); // repeated pushes bisect
    // each stamp's actual work is base·1 or base·(1 + GUARD_STEPS)
    const extra = (m.work - base) / GUARD_STEPS;
    expect(Number.isInteger(extra)).toBe(true);
  });
});

describe('sanitizeStrokes (§5.2)', () => {
  const ok = (id: string, over: Partial<Stroke> = {}): Stroke => ({
    id,
    kind: 'push',
    radius: RM,
    strength: PUSH_GAIN,
    points: Float32Array.of(0.2, 0.2, 0.21, 0.2),
    ...over,
  });

  it('keeps valid records in order and drops each malformed one alone', () => {
    const raw: unknown[] = [
      ok('a'),
      { ...ok('b'), kind: 'twirl' },
      ok('a'), // duplicate id: the first is kept
      { ...ok('c'), id: '' },
      { ...ok('d'), points: Float32Array.of(0.2, 0.2, 0.3) }, // odd length
      { ...ok('e'), points: Float32Array.of(0.2, 0.2) }, // one point
      { ...ok('f'), points: Float32Array.of(0.2, 0.2, 2.5, 0.2) }, // outside [−1, 2]
      { ...ok('g'), points: Float32Array.of(0.2, NaN, 0.3, 0.2) },
      { ...ok('h'), radius: Infinity },
      { ...ok('i'), strength: NaN },
      { ...ok('j'), points: [0.2, 0.2, 0.25, 0.2] }, // an array is converted
      { ...ok('k'), radius: 9, strength: 4 }, // clamped
      { ...ok('l'), radius: 0 },
      null,
      'x',
    ];
    const out = sanitizeStrokes(raw, FRAME);
    expect(out.map((r) => r.id)).toEqual(['a', 'j', 'k', 'l']);
    expect(out[1].points).toBeInstanceOf(Float32Array);
    expect(out[2].radius).toBe(R_MAX);
    expect(out[2].strength).toBe(1);
    expect(out[3].radius).toBe(rMin(FRAME));
  });

  it('drops the first over-cap record and every later one', () => {
    const many = Array.from({ length: MAX_STROKES + 5 }, (_, i) => ok(`r${i}`));
    expect(sanitizeStrokes(many, FRAME)).toHaveLength(MAX_STROKES);
    const [big] = straightStroke(FRAME, 'push', R_MAX, { x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }, 'big');
    const per = strokeWork(big, FRAME);
    const fit = Math.floor(LIQUIFY_WORK_CAP / per);
    expect(fit + 2).toBeLessThan(MAX_STROKES); // the work cap binds first
    const list = [...Array.from({ length: fit + 1 }, (_, i) => ({ ...big, id: `big${i}` })), ok('tail')];
    expect(sanitizeStrokes(list, FRAME).map((r) => r.id)).toEqual(list.slice(0, fit).map((r) => r.id));
  });

  it('without a frame (the camera look) every stroke is dropped', () => {
    expect(sanitizeStrokes([ok('a')], null)).toEqual([]);
    expect(sanitizeStrokes('nope', FRAME)).toEqual([]);
  });
});

describe('maxDisp, backward, ids', () => {
  it('maxDisp bounds |L| (in long-edge units: × the decode long edge = px) on a dense sample of the rect; backward = o + L(o)', () => {
    const { m } = model();
    drag(m, 'push', RL, 0.3, 0.4, 2 * RL, RL);
    const r = { x: 0.2, y: 0.25, w: 0.3, h: 0.2 };
    const bound = m.maxDisp(r);
    const long = Math.max(FRAME.width, FRAME.height);
    let seen = 0;
    for (let j = 0; j <= 100; j++)
      for (let i = 0; i <= 100; i++) {
        const o = { x: r.x + (r.w * i) / 100, y: r.y + (r.h * j) / 100 };
        const b = m.backward(o);
        if (i % 10 === 0 && j % 10 === 0) {
          // backward(o) = o + L(o) with the bilinear, clamp-to-edge read (fieldAt's arithmetic)
          const [du, dv] = fieldAt(m.field!, o.x, o.y);
          expect([b.x, b.y]).toEqual([o.x + du, o.y + dv]);
        }
        // the displacement in pixels of a 4096-long decode, over that long edge
        seen = Math.max(seen, Math.hypot(((b.x - o.x) * FRAME.width) / long, ((b.y - o.y) * FRAME.height) / long));
      }
    expect(seen).toBeGreaterThan(0);
    expect(bound).toBeGreaterThanOrEqual(seen);
    expect(m.maxAbs).toBeLessThanOrEqual(bound);
    expect(m.maxAbs).toBeGreaterThan(0);
    expect(model().m.maxDisp(r)).toBe(0);
    expect(model().m.maxAbs).toBe(0);
  });

  it('makeStrokeId: 8 base-36 characters, redrawn on a collision', () => {
    let n = 0;
    const rand = (a: Uint8Array) => a.fill(n++ === 0 ? 0 : 1);
    expect(makeStrokeId(new Set(['00000000']), rand)).toBe('11111111');
    expect(makeStrokeId(new Set())).toMatch(/^[0-9a-z]{8}$/);
  });
});

// PB §8.4 / C §8.3: the replay fixtures are the generators' output, committed. `WRITE_STROKE_FIXTURES=1` (re)writes
// them; a normal run asserts the committed files still equal what the generators produce.
describe('stroke fixtures (tests/fixtures/strokes_*.json)', () => {
  for (const [name, gen] of [
    ['strokes_s30.json', strokesS30],
    ['strokes_cap.json', strokesCap],
  ] as const) {
    it(`${name} is the generator's output on the measuring frame`, () => {
      const recs = gen(FRAME);
      const json = fixtureJson(recs);
      if (process.env.WRITE_STROKE_FIXTURES === '1') writeFileSync(fixturePath(name), json);
      expect(existsSync(fixturePath(name)), `missing: run WRITE_STROKE_FIXTURES=1 npx vitest run src/edit/liquify.test.ts -t "stroke fixtures"`).toBe(true);
      expect(JSON.parse(readFileSync(fixturePath(name), 'utf8'))).toEqual(JSON.parse(json));
      const back = readFixture(name);
      expect(back.map((r) => r.id)).toEqual(recs.map((r) => r.id));
      expect(back.every((r) => r.points instanceof Float32Array)).toBe(true);
    }, 60_000);
  }
});
