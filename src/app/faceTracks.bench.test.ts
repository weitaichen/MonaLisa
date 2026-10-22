// PB (camera per-person spec §6.5, §10, §12.1): the bookkeeping of one detection at 10 faces (matching, re-identification
// and the One-Euro smoother, 478 × 3 filters per face) stays ≤ 1 ms on the desktop. A benchmark, so it runs only with
// BENCH set: `BENCH=1 npx vitest run src/app/faceTracks.bench.test.ts`. Over the budget → profile (no limit changes).
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { naturalPerson } from '../edit/state';
import type { Landmarks478 } from '../types';
import { FaceTracks } from './faceTracks';
import { LivePersons } from './livePersons';

const sample = JSON.parse(readFileSync(new URL('../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as { points: number[] };
/** the recorded sample face moved so its points' bbox is centred at (cx, cy) with width w (UV), as faceTracks.test.ts */
function lmAt(cx: number, cy: number, w: number): Landmarks478 {
  const p = sample.points;
  let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
  for (let i = 0; i < 478; i++) {
    x0 = Math.min(x0, p[i * 3]); x1 = Math.max(x1, p[i * 3]);
    y0 = Math.min(y0, p[i * 3 + 1]); y1 = Math.max(y1, p[i * 3 + 1]);
  }
  const s = w / (x1 - x0);
  const out = new Float32Array(478 * 3);
  for (let i = 0; i < 478; i++) {
    out[i * 3] = cx + (p[i * 3] - (x0 + x1) / 2) * s;
    out[i * 3 + 1] = cy + (p[i * 3 + 1] - (y0 + y1) / 2) * s;
    out[i * 3 + 2] = p[i * 3 + 2] * s;
  }
  return { points: out };
}

/** a seeded uniform in [-1, 1) (mulberry32): the same jitter every run */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 31 - 1;
  };
}

const W = 1280;
const H = 720;
const FRAME_MS = 33;
const WARMUP = 50;
const TIMED = 1000;
/** distinct jittered frames, cycled (built before the clock starts, so the timing is the bookkeeping only) */
const POOL = 64;

describe('PB (camera per-person spec §10)', () => {
  it.runIf(process.env.BENCH)('PB: matching + re-identification + smoother at 10 faces ≤ 1 ms per detection', () => {
    // ten faces in two rows of five, 0.08 wide: no two overlap, so every face keeps its own track
    const centres = Array.from({ length: 10 }, (_, i) => [0.14 + (i % 5) * 0.18, i < 5 ? 0.3 : 0.7] as const);
    const jitter = rng(0x50b);
    const frames = Array.from({ length: POOL }, () =>
      centres.map(([cx, cy]) => lmAt(cx + 0.002 * jitter(), cy + 0.002 * jitter(), 0.08)),
    );
    // an edited session: every face's person is edited (全部套用 with 自然), so each track eases and claims as in use
    const persons = new LivePersons();
    persons.setAll(true);
    persons.edit(naturalPerson());
    const tracks = new FaceTracks(persons);
    let now = 0;
    const once = (i: number) => {
      now += FRAME_MS;
      tracks.detect(frames[i % POOL], now, W, H);
      tracks.step(FRAME_MS, now);
    };
    for (let i = 0; i < WARMUP; i++) once(i);
    expect(tracks.views().filter((v) => v.present)).toHaveLength(10);
    const t0 = performance.now();
    for (let i = 0; i < TIMED; i++) once(WARMUP + i);
    const mean = (performance.now() - t0) / TIMED;
    console.log(`PB mean ${mean.toFixed(3)} ms per detection (10 faces, ${TIMED} detect + step, limit 1 ms)`);
    expect(tracks.views().filter((v) => v.present)).toHaveLength(10);
    expect(mean).toBeLessThanOrEqual(1);
  });
});
