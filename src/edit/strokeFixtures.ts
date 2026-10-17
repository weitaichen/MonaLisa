// Deterministic stroke lists for the replay tests and the bench (push-brush spec §6.2, §8.4): our own data, generated
// from a seeded PRNG. tests/fixtures/strokes_s30.json and strokes_cap.json are these lists on the 3:4 measuring frame,
// pinned to them by liquify.test.ts. S30 = 30 typical strokes (a cheek push is about 9 stamps); SCAP = records up to
// LIQUIFY_WORK_CAP of actual work.
import { LIQUIFY_WORK_CAP, MAX_STROKES } from '../config/limits';
import type { LiquifyFrame, Stroke } from '../types';
import { LiquifyModel, liquifyGrid, StrokeBuilder } from './liquify';

/** mulberry32: a small seeded PRNG (tests and bench only) */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** one straight record from O point a to b (raw points every radius/16 in S units) */
export function straightStroke(
  frame: LiquifyFrame,
  kind: Stroke['kind'],
  radius: number,
  a: { x: number; y: number },
  b: { x: number; y: number },
  id: string,
): Stroke[] {
  const g = liquifyGrid(frame);
  const len = Math.hypot((b.x - a.x) * g.ax, (b.y - a.y) * g.ay);
  const n = Math.max(1, Math.ceil(len / (radius / 16)));
  const sb = new StrokeBuilder(kind, radius, frame, a);
  for (let k = 1; k <= n; k++) sb.add({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  let i = 0;
  return sb.finish(() => (i++ === 0 ? id : `${id}-${i - 1}`));
}

/** 30 typical strokes: 中 pushes of 2 radii (about 9 stamps each) on a 6 × 5 grid, each in its own direction */
export function strokesS30(frame: LiquifyFrame): Stroke[] {
  const g = liquifyGrid(frame);
  const R = 28.7 / g.F;
  const out: Stroke[] = [];
  for (let k = 0; k < 30; k++) {
    const cx = 0.1 + 0.16 * (k % 6);
    const cy = 0.1 + 0.2 * Math.floor(k / 6);
    const ang = (k * 2 * Math.PI) / 7;
    const a = { x: cx / g.ax, y: cy / g.ay };
    const b = { x: (cx + 2 * R * Math.cos(ang)) / g.ax, y: (cy + 2 * R * Math.sin(ang)) / g.ay };
    out.push(...straightStroke(frame, 'push', R, a, b, `s30-${k}`));
  }
  return out;
}

/** 大 pushes across the photo, kept while the replay's actual work stays within LIQUIFY_WORK_CAP (what the app allows) */
export function strokesCap(frame: LiquifyFrame): Stroke[] {
  const r = prng(4242);
  const g = liquifyGrid(frame);
  const R = (28.7 / g.F) * (44 / 28);
  const m = new LiquifyModel(frame, { syncWork: Infinity, now: () => 0 });
  const out: Stroke[] = [];
  for (let k = 0; ; k++) {
    const a = { x: 0.1 + 0.8 * r(), y: 0.1 + 0.8 * r() };
    const b = { x: 0.1 + 0.8 * r(), y: 0.1 + 0.8 * r() };
    const next = [...out, ...straightStroke(frame, 'push', R, a, b, `cap-${k}`)];
    if (next.length > MAX_STROKES) break;
    m.sync(next);
    if (m.work > LIQUIFY_WORK_CAP) break;
    out.splice(0, out.length, ...next);
  }
  m.dispose();
  return out;
}
