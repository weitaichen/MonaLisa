// PB (camera per-person spec §6.5, §10, §12.1): the bookkeeping of a detection at 10 faces (matching, re-identification
// and the One-Euro smoother, 478 × 3 filters per face) stays ≤ 1 ms per detection on the desktop, on average over each
// class of calls below (round-3 review E9: a call's own time, the p99 and the max are logged, not gated). A benchmark,
// so it runs only with BENCH set: `BENCH=1 npx vitest run src/app/faceTracks.bench.test.ts`. Over the budget → profile
// (no limit changes).
//
// Four phases, each reported against the limit (round-1 review C21: the first PB fed the same ten faces throughout, so
// no track was ever dropped or re-identified, and every call was the solo path's):
// - solo, steady: ten faces held still (jittered), every call the solo path's whole frame (the PB of 2026-10-22);
// - solo, faces leave and return: two groups of ten take turns in view, so every turn drops ten tracks into a full away
//   pool of edited persons (the tracks at the cap are evicted, `release`) and re-identifies the ten coming back from it
//   (`awayCandidates`, `take`), against the ten tracks just held;
// - group path, steady and leave-and-return: the same on the group path's views (§6.6, 合照模式 on), ten far faces at
//   3–4 % of an upright 1080 × 1920 frame's long edge, each call one view's: the refresh schedule (`refreshViews`,
//   `ViewSchedule`), the view's landmarks mapped to stream UV (`mapLandmarks`) and the scoped matching (`viewScope`).
//   Each view answers the faces it holds whole (a tile) or every face in the crop (the whole view, which on
//   `upright_far10` found all ten, §6.1)
// Each detection is followed by the frame's `step`, as in the live loop; the frames are built before the clock starts.
// Gated per phase (round-2 review D11): the mean of the calls that release or re-identify anyone, on their own, and the
// mean of the other calls. Over the whole phase a turn's one call in 36 was diluted under the limit while it took
// 1.3 ms; profiled, the ten new tracks' smoothers (10 × 1434 OneEuro objects) were 0.7 ms of it (oneEuro.ts since).
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { naturalPerson } from '../edit/state';
import { ovalBox } from '../engine/passes/faceCap';
import { adapt } from '../tracking/adapter111';
import type { Landmarks478, PxRect, Rect } from '../types';
import { FaceTracks } from './faceTracks';
import { type LivePersonId, LivePersons } from './livePersons';
import { holdsWhole, layoutViews, type LiveView, mapLandmarks, refreshViews, ViewSchedule, viewScope } from './liveViews';

const sample = JSON.parse(readFileSync(new URL('../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as { points: number[] };
/**
 * the recorded sample face moved so its points' bbox is centred at (cx, cy) with width w (UV), as faceTracks.test.ts;
 * its height scaled by `ys` more (1: as faceTracks.test.ts; the group frames pass the sample's 1000 × 1500 px over the
 * frame's px, so the face keeps its shape)
 */
function lmAt(cx: number, cy: number, w: number, ys = 1): Landmarks478 {
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
    out[i * 3 + 1] = cy + (p[i * 3 + 1] - (y0 + y1) / 2) * s * ys;
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

const FRAME_MS = 33;
const WARMUP = 50;
const TIMED = 1000;
/** distinct jittered frames, cycled (built before the clock starts, so the timing is the bookkeeping only) */
const POOL = 64;
/** leave and return: each group is in view this many frames (1.2 s), so a group comes back 1.2 s after it left, inside the 4 s grace */
const TURN = 36;
/** leave and return warms up over three turns: both groups have their persons, and the pool is full, before the clock starts */
const WARMUP_TURNS = 3 * TURN;

/** the session of the live loop, counting what PB is to exercise: releases (to the away pool) and re-identifications */
class CountingPersons extends LivePersons {
  releases = 0;
  reids = 0;
  /** persons made new (not taken from the away pool) */
  made = 0;
  override release(...a: Parameters<LivePersons['release']>): void {
    this.releases++;
    super.release(...a);
  }
  override take(away: LivePersonId | null): LivePersonId {
    const id = super.take(away);
    if (away !== null && id === away) this.reids++;
    else this.made++;
    return id;
  }
}

/** an edited session: every face's person is edited (全部套用 with 自然), so each track eases, and each drop goes to the pool */
function editedSession(path: 'solo' | 'group'): CountingPersons {
  const persons = new CountingPersons();
  persons.setPath(path, 0);
  persons.setAll(true);
  persons.edit(naturalPerson());
  return persons;
}

interface Phase {
  name: string;
  warmup: number;
  /** one detection and the frame's step, frame `i` at `now` */
  once: (i: number, now: number) => void;
  tracks: FaceTracks;
  persons: CountingPersons;
  /** the group path's views called (the whole view and the tiles) */
  used?: Set<string>;
}

/** the times of a set of calls (ms); n 0: none */
interface Times {
  n: number;
  mean: number;
  median: number;
  p99: number;
  max: number;
}

function times(xs: readonly number[]): Times {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (!n) return { n, mean: 0, median: 0, p99: 0, max: 0 };
  return { n, mean: s.reduce((a, b) => a + b, 0) / n, median: s[Math.floor(n / 2)], p99: s[Math.min(n - 1, Math.floor(0.99 * n))], max: s[n - 1] };
}

const fmt = (t: Times) => `n ${t.n}, mean ${t.mean.toFixed(3)}, median ${t.median.toFixed(3)}, p99 ${t.p99.toFixed(3)}, max ${t.max.toFixed(3)} ms`;

/**
 * runs the phase: warm-up, then TIMED detections timed one by one. Round-2 review D11: each call is classed by what it
 * did, so the gate reads the calls that release or re-identify anyone (a turn's: about one call in 36) on their own and
 * not diluted by the steady calls around them; `every` is all TIMED calls, logged as before
 */
function measure(p: Phase): { every: Times; turn: Times; steady: Times; counts: { releases: number; reids: number; made: number } } {
  let now = 0;
  for (let i = 0; i < p.warmup; i++) p.once(i, (now += FRAME_MS));
  p.used?.clear();
  const before = { releases: p.persons.releases, reids: p.persons.reids, made: p.persons.made };
  const each = new Float64Array(TIMED);
  /** the call released, re-identified or made someone */
  const turned = new Uint8Array(TIMED);
  for (let i = 0; i < TIMED; i++) {
    const at = (now += FRAME_MS);
    const was = p.persons.releases + p.persons.reids + p.persons.made;
    const t0 = performance.now();
    p.once(p.warmup + i, at);
    each[i] = performance.now() - t0;
    turned[i] = p.persons.releases + p.persons.reids + p.persons.made === was ? 0 : 1;
  }
  const counts = { releases: p.persons.releases - before.releases, reids: p.persons.reids - before.reids, made: p.persons.made - before.made };
  const every = times([...each]);
  const turn = times([...each].filter((_, i) => turned[i]));
  const steady = times([...each].filter((_, i) => !turned[i]));
  console.log(
    `PB ${p.name} (10 faces, ${TIMED} detect + step, limit 1 ms; timed: ${counts.releases} released, ${counts.reids} re-identified, ${counts.made} new)\n` +
      `  every call: ${fmt(every)}\n  calls that release or re-identify: ${fmt(turn)}\n  the other calls: ${fmt(steady)}`,
  );
  return { every, turn, steady, counts };
}

// ── the solo path: 1280 × 720, faces 0.08 wide ──
const SW = 1280;
const SH = 720;
/** group A: two rows of five, no two overlapping, so every face keeps its own track */
const SOLO_A = Array.from({ length: 10 }, (_, i) => [0.14 + (i % 5) * 0.18, i < 5 ? 0.3 : 0.7] as const);
/** group B: half a column right and a row between: each B face farther from every A face than §7.4's 1.5 widths */
const SOLO_B = SOLO_A.map(([x, y]) => [x + 0.09, y + 0.2] as const);

function soloPhase(name: string, turns: boolean): Phase {
  const jitter = rng(0x50b);
  const frames = (centres: readonly (readonly [number, number])[]) =>
    Array.from({ length: POOL }, () => centres.map(([cx, cy]) => lmAt(cx + 0.002 * jitter(), cy + 0.002 * jitter(), 0.08)));
  const a = frames(SOLO_A);
  const b = turns ? frames(SOLO_B) : a;
  const persons = editedSession('solo');
  const tracks = new FaceTracks(persons);
  return {
    name,
    warmup: turns ? WARMUP_TURNS : WARMUP,
    tracks,
    persons,
    once: (i, now) => {
      tracks.detect((Math.floor(i / TURN) % 2 ? b : a)[i % POOL], now, SW, SH);
      tracks.step(FRAME_MS, now);
    },
  };
}

// ── the group path: an upright 1080 × 1920 frame, its 3:4 crop, the back camera's full-range tiles (§6.6) ──
const GW = 1080;
const GH = 1920;
const CROP: PxRect = { x: 0, y: 240, w: 1080, h: 1440 };
/** 67 px faces (3.5 % of the long edge), as upright_far10; the sample's px aspect kept */
const FAR_W = 67 / GW;
const FAR_YS = (1500 / 1000) * (GW / GH);
/** group A: two rows of five, centres 2.66 face widths apart, rows 192 px apart (upright_far10's layout) */
const FAR_A = Array.from({ length: 10 }, (_, i) => [0.17 + (i % 5) * 0.165, i < 5 ? 0.42 : 0.52] as const);
/** group B: half a column right, each row 192 px out: farther from every A face than §7.4's gates */
const FAR_B = FAR_A.map(([x, y]) => [x + 0.0825, y < 0.5 ? y - 0.1 : y + 0.1] as const);

function groupPhase(name: string, turns: boolean): Phase {
  const lay = layoutViews(GW, GH, CROP, 'environment', 'photo');
  const views: LiveView[] = [lay.whole, ...lay.tiles];
  const inCrop = (b: { x: number; y: number; w: number; h: number }) =>
    b.x * GW < CROP.x + CROP.w && (b.x + b.w) * GW > CROP.x && b.y * GH < CROP.y + CROP.h && (b.y + b.h) * GH > CROP.y;
  /** a stream-UV face → view-normalized, as the view's IMAGE call would answer it (mapLandmarks' inverse) */
  const toView = (lm: Landmarks478, r: PxRect): Landmarks478 => {
    const src = lm.points;
    const out = new Float32Array(src.length);
    for (let i = 0; i + 2 < src.length; i += 3) {
      out[i] = (src[i] * GW - r.x) / r.w;
      out[i + 1] = (src[i + 1] * GH - r.y) / r.h;
      out[i + 2] = (src[i + 2] * GW) / r.w;
    }
    return { points: out };
  };
  const jitter = rng(0x50b);
  const j = 0.025 * FAR_W;
  /** per pool frame, per view id: the faces that view's call answers, normalized to the view */
  const frames = (centres: readonly (readonly [number, number])[]) =>
    Array.from({ length: POOL }, () => {
      const faces = centres.map(([cx, cy]) => lmAt(cx + j * jitter(), cy + j * jitter(), FAR_W, FAR_YS));
      const boxes = faces.map((lm) => ovalBox(adapt(lm, GW, GH)));
      const byView = new Map<string, Landmarks478[]>();
      for (const v of views) {
        const finds = (k: number) => (v.kind === 'tile' ? holdsWhole(v, boxes[k], lay) : inCrop(boxes[k]));
        byView.set(v.id, faces.flatMap((lm, k) => (finds(k) ? [toView(lm, v.rect)] : [])));
      }
      return byView;
    });
  const a = frames(FAR_A);
  const b = turns ? frames(FAR_B) : a;
  const persons = editedSession('group');
  const tracks = new FaceTracks(persons);
  const schedule = new ViewSchedule();
  const used = new Set<string>();
  return {
    name,
    warmup: turns ? WARMUP_TURNS : WARMUP,
    tracks,
    persons,
    used,
    // live.ts detectOnce and viewCall, the tracker's IMAGE call aside
    once: (i, now) => {
      const boxes: Rect[] = [];
      for (const v of tracks.views()) {
        const p = tracks.predicted(v.id, now);
        if (p) boxes.push(p);
      }
      const view = schedule.next(lay, refreshViews(lay, boxes), tracks.views().length);
      used.add(view.id);
      const lms = (Math.floor(i / TURN) % 2 ? b : a)[i % POOL].get(view.id)!;
      tracks.detect(lms.map((lm) => mapLandmarks(lm, view.rect, GW, GH)), now, GW, GH, viewScope(view, lay));
      tracks.step(FRAME_MS, now);
    },
  };
}

describe('PB (camera per-person spec §10)', () => {
  it.runIf(process.env.BENCH)('PB solo path, steady: matching + smoother at 10 faces ≤ 1 ms per detection', () => {
    const p = soloPhase('solo, steady', false);
    const { every, turn } = measure(p);
    expect(p.tracks.views().filter((v) => v.present)).toHaveLength(10);
    expect(turn.n).toBe(0);
    expect(every.mean).toBeLessThanOrEqual(1);
  });

  it.runIf(process.env.BENCH)('PB solo path, faces leave and return: the calls that drop ten into a full away pool and re-identify ten ≤ 1 ms on average', () => {
    const p = soloPhase('solo, leave and return', true);
    const { turn, steady, counts } = measure(p);
    // every turn released the ten leaving and re-identified the ten coming back: nobody came back as someone new
    expect(counts.releases).toBeGreaterThanOrEqual(10 * Math.floor(TIMED / TURN));
    expect(counts.reids).toBeGreaterThanOrEqual(10 * Math.floor(TIMED / TURN));
    expect(counts.made).toBe(0);
    // round-2 review D11: the re-identifying calls themselves, not the phase's mean (35 steady calls a turn dilute them)
    expect(turn.n).toBeGreaterThanOrEqual(Math.floor(TIMED / TURN));
    expect(turn.mean).toBeLessThanOrEqual(1);
    expect(steady.mean).toBeLessThanOrEqual(1);
  });

  it.runIf(process.env.BENCH)('PB group path, steady: the scoped matching of each view call at 10 far faces ≤ 1 ms per detection', () => {
    const p = groupPhase('group path, steady', false);
    const { every, turn } = measure(p);
    expect(p.tracks.views().filter((v) => v.present)).toHaveLength(10);
    // the cycle of §6.1's row LF on upright_far10: the whole view and the two tiles of the middle row
    expect([...p.used!].sort()).toEqual(['t0,1', 't1,1', 'whole']);
    expect(turn.n).toBe(0);
    expect(every.mean).toBeLessThanOrEqual(1);
  });

  it.runIf(process.env.BENCH)('PB group path, faces leave and return: the scoped calls that drop and re-identify ≤ 1 ms on average', () => {
    const p = groupPhase('group path, leave and return', true);
    const { turn, steady, counts } = measure(p);
    expect(counts.releases).toBeGreaterThanOrEqual(10 * Math.floor(TIMED / TURN));
    expect(counts.reids).toBeGreaterThanOrEqual(10 * Math.floor(TIMED / TURN));
    expect(counts.made).toBe(0);
    expect(turn.n).toBeGreaterThanOrEqual(Math.floor(TIMED / TURN));
    expect(turn.mean).toBeLessThanOrEqual(1);
    expect(steady.mean).toBeLessThanOrEqual(1);
  });
});
