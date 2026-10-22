import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_LIVE_FACES } from '../config/limits';
import { boxIoU } from '../detect/faces';
import { splitLegacy } from '../edit/legacy';
import { naturalPerson } from '../edit/state';
import { applyPreset } from '../engine/params';
import { ovalBox } from '../engine/passes/faceCap';
import { makeupUniformsFor } from '../engine/passes/makeup';
import { reshapeUniforms } from '../engine/passes/reshape';
import { planFrame } from '../engine/pipeline';
import { ROSY_MAX_OPACITY, skinMaxima, skinUniformsFor } from '../engine/uniforms';
import { adapt } from '../tracking/adapter111';
import type { Landmarks478, PersonParams, Rect } from '../types';
import { liveFrame } from './live';
import { FaceWeightEaser } from './liveCore';
import { LivePersons } from './livePersons';
import { layoutViews, viewScope, type DetectScope } from './liveViews';
import { cameraTapAction, ChipGate, coverTapUv, FaceTracks, videoToFrame } from './faceTracks';

const sample = JSON.parse(readFileSync(new URL('../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as { points: number[] };
/** the recorded sample face moved so its points' bbox is centred at (cx, cy) with width w (UV) */
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
const W = 1280;
const H = 720;
/** run detections at 30 fps; returns the time after the last frame */
function run(t: FaceTracks, frames: number, at: (i: number) => readonly Landmarks478[] | null, t0 = 0): number {
  let now = t0;
  for (let i = 0; i < frames; i++) {
    now = t0 + i * 33;
    t.detect(at(i), now, W, H);
    t.step(33, now);
  }
  return now;
}
const A = (dx = 0) => lmAt(0.3 + dx, 0.5, 0.2);
const B = (w = 0.2) => lmAt(0.7, 0.5, w);
/** a session in which every face is edited (全部套用 with `p`, 自然 by default): weights behave as v0.5's beautified face */
function editedAll(p: PersonParams = naturalPerson()): LivePersons {
  const s = new LivePersons();
  s.setAll(true);
  s.edit(p);
  return s;
}
/** the target's track (v0.5's beautified one) */
const selected = (t: FaceTracks) => t.views().find((v) => v.selected) ?? null;

describe('FaceTracks (S §3.4 T4)', () => {
  it('the centre rule pairs a face that shrank ×1.4 and moved 0.45 widths (box IoU < 0.3); ids and persons stay', () => {
    const t = new FaceTracks(new LivePersons());
    run(t, 3, () => [lmAt(0.3, 0.5, 0.28), B()]);
    const before = [...t.views()].sort((a, b) => a.id - b.id);
    expect(before).toHaveLength(2);
    const a = before.find((v) => v.box.x < 0.5)!;
    const moved = lmAt(0.3 + 0.45 * 0.28, 0.5, 0.28 / 1.4);
    // the track does not move (velocity 0), so its predicted box is its box
    expect(boxIoU(a.box, ovalBox(adapt(moved, W, H)))).toBeLessThan(0.3);
    run(t, 1, () => [moved, B()], 200);
    const after = [...t.views()].sort((x, y) => x.id - y.id);
    expect(after.map((v) => [v.id, v.person])).toEqual(before.map((v) => [v.id, v.person]));
    expect(after.every((v) => v.present)).toBe(true);
  });
  it('two detections converged on one face are one track', () => {
    const t = new FaceTracks(new LivePersons());
    run(t, 5, () => [A(), A(0.002)]);
    expect(t.views()).toHaveLength(1);
  });
  it('no answer (null) keeps the tracks and the selection; the weights ease out', () => {
    const s = new LivePersons();
    const t = new FaceTracks(s);
    run(t, 10, () => [A(), B()]);
    const b = t.views().find((v) => v.box.x > 0.5)!.person;
    s.write(t.views().map((v) => v.person), naturalPerson()); // both drawn, so the ease-out shows on both
    s.pin(b);
    run(t, 10, () => [A(), B()], 400);
    expect(t.views().map((v) => v.weight)).toEqual([1, 1]);
    run(t, 60, () => null, 800);
    expect(t.views()).toHaveLength(2);
    expect(s.selection()).toBe(b);
    expect(selected(t)!.person).toBe(b);
    expect(t.views().every((v) => v.weight === 0)).toBe(true);
  });
  it('a missing track is held for LOST_HOLD_MS, then dropped; a pinned selection returns to auto', () => {
    const s = new LivePersons();
    const t = new FaceTracks(s);
    run(t, 10, () => [A(), B()]);
    const b = t.views().find((v) => v.box.x > 0.5)!.person;
    s.pin(b);
    run(t, 25, () => [A()], 400); // 800 ms without B
    expect(t.views()).toHaveLength(2);
    run(t, 10, () => [A()], 1300);
    expect(t.views()).toHaveLength(1);
    expect(s.selection()).toBe('auto');
  });
  it('Review Focus #4: a no-answer stretch longer than LOST_HOLD_MS (a context loss) does not age the hold (S §3.4 T4)', () => {
    const s = new LivePersons();
    const t = new FaceTracks(s);
    run(t, 10, () => [A(), B()]);
    const b = t.views().find((v) => v.box.x > 0.5)!.person;
    s.pin(b);
    run(t, 90, () => null, 400); // 3 s without an answer
    run(t, 15, () => [A()], 3400); // answers again, B missed for the first 460 ms
    expect(t.views()).toHaveLength(2);
    expect(s.selection()).toBe(b);
    run(t, 5, () => [A(), B()], 3900); // found again near its last centre: the same track, still pinned
    expect(selected(t)!.person).toBe(b);
  });
  it('auto picks the largest and switches only after another stays ≥ 1.2× larger for 500 ms (A7)', () => {
    const t = new FaceTracks(new LivePersons());
    run(t, 10, () => [A(), B(0.15)]);
    const a = selected(t)!.id;
    expect(t.views().find((v) => v.id === a)!.box.x).toBeLessThan(0.5);
    let now = run(t, 12, () => [A(), B(0.24)], 400); // 1.44× for 363 ms: not yet
    expect(selected(t)!.id).toBe(a);
    now = run(t, 10, () => [A(), B(0.24)], now + 33); // the smoothed box needs a frame or two to pass 1.2×
    expect(selected(t)!.id).not.toBe(a);
    const t2 = new FaceTracks(new LivePersons());
    run(t2, 10, () => [A()]); // A is the auto pick first (B(0.21) is the largest from frame 0 otherwise)
    run(t2, 30, () => [A(), B(0.21)], 400); // then a face 1.1× larger for 1 s: never
    expect(selected(t2)!.box.x).toBeLessThan(0.5);
  });
  it('Review Focus #4: a second face flickering in every other detection never takes the beautify, even when larger', () => {
    const t = new FaceTracks(new LivePersons());
    run(t, 10, () => [A()]);
    const a = selected(t)!.id;
    run(t, 120, (i) => (i % 2 ? [A(), B(0.3)] : [A()]), 400);
    expect(selected(t)!.id).toBe(a);
  });
  it('one face: the weight and anyFace equal v0.3’s single easer, frame by frame (live parity)', () => {
    const t = new FaceTracks(editedAll());
    const e = new FaceWeightEaser();
    const seq = [1, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 1];
    seq.forEach((present, i) => {
      t.detect(present ? [A()] : [], i * 33, W, H);
      t.step(33, i * 33);
      const want = e.update(present === 1, 33);
      expect(t.anyFace).toBe(want);
      expect(t.views()[0]?.weight ?? 0).toBe(want);
    });
  });
  it('with maxFaces 1 the smoother is bypassed: the shown face is the raw one (v0.3)', () => {
    const t = new FaceTracks(new LivePersons(), { maxFaces: 1 });
    run(t, 3, (i) => [A(i * 0.01)]);
    expect(Array.from(t.views()[0].face.pts111)).toEqual(Array.from(adapt(A(0.02), W, H).pts111));
  });
  it('hitTest: boxes grown to the 44 pt minimum, nearest centre among several', () => {
    const t = new FaceTracks(new LivePersons());
    run(t, 5, () => [A(), B()]);
    const [va, vb] = [...t.views()].sort((x, y) => x.box.x - y.box.x);
    expect(t.hitTest(va.box.x + va.box.w / 2, 0.5, 0.01, 0.01)).toBe(va.id);
    expect(t.hitTest(0.5, 0.5, 0.01, 0.01)).toBeNull();
    expect(t.hitTest(0.5, 0.5, 0.9, 0.9)).not.toBeNull();
    expect(t.hitTest(vb.box.x + vb.box.w / 2, 0.5, 0.9, 0.9)).toBe(vb.id);
  });
});

describe('FaceTracks on persons: prediction, the size gate, continuation, eviction (camera per-person spec §7.2–§7.5)', () => {
  it('predicts each track by its velocity (EMA τ 200 ms), at most one box width away (§7.2)', () => {
    const t = new FaceTracks(new LivePersons());
    run(t, 10, (i) => [lmAt(0.3 + i * 0.005, 0.5, 0.2)]);
    const v = t.views()[0];
    const dx = t.predicted(v.id, 9 * 33 + 200)!.x - v.box.x;
    expect(dx).toBeGreaterThan(0.5 * (0.005 / 33) * 200);
    expect(dx).toBeLessThanOrEqual((0.005 / 33) * 200 + 1e-9);
    expect(t.predicted(v.id, 9 * 33 + 60_000)!.x - v.box.x).toBeCloseTo(v.box.w, 9);
  });
  it('two faces swap places, one passing behind the other for ~330 ms: each person follows its face', () => {
    const t = new FaceTracks(new LivePersons());
    const now = run(t, 10, () => [lmAt(0.35, 0.5, 0.15), lmAt(0.65, 0.5, 0.15)]);
    const [pb, pc] = [...t.views()].sort((a, b) => a.box.x - b.box.x).map((v) => v.person);
    for (let ms = 33; ms <= 1000; ms += 33) {
      const b = 0.35 + 0.0003 * ms;
      const c = 0.65 - 0.0003 * ms;
      t.detect(Math.abs(b - c) < 0.1 ? [lmAt(b, 0.5, 0.15)] : [lmAt(b, 0.5, 0.15), lmAt(c, 0.5, 0.15)], now + ms, W, H);
      t.step(33, now + ms);
    }
    const x = new Map(t.views().map((v) => [v.person, v.box.x + v.box.w / 2]));
    expect(x.get(pb)!).toBeGreaterThan(0.6);
    expect(x.get(pc)!).toBeLessThan(0.4);
  });
  it('a face twice as large where a track was is someone stepping in front: a new person; the covered one is held (TRACK_SIZE_JUMP)', () => {
    const t = new FaceTracks(new LivePersons());
    run(t, 5, () => [A()]);
    const [a] = t.views();
    run(t, 3, () => [lmAt(0.3, 0.5, 0.4)], 200);
    const v = t.views();
    expect(v).toHaveLength(2);
    expect(v.find((x) => x.id === a.id)).toMatchObject({ person: a.person, present: false });
    expect(v.find((x) => x.id !== a.id)!.person).not.toBe(a.person);
  });
  it('a lone face that jumps 0.8 widths is continued by the re-identification gates; one that jumps across the frame is a new person', () => {
    for (const [to, same] of [[0.3 + 0.8 * 0.2, true], [0.8, false]] as const) {
      const t = new FaceTracks(new LivePersons());
      let now = run(t, 10, () => [A()]);
      const p = t.views()[0].person;
      now = run(t, 5, () => [], now + 33);
      run(t, 3, () => [lmAt(to, 0.5, 0.2)], now + 33);
      const present = t.views().filter((v) => v.present);
      expect(present).toHaveLength(1);
      expect(present[0].person === p).toBe(same);
    }
  });
  it("maxFaces 1 keeps v0.3's one track, one face: a face anywhere continues the lone track", () => {
    const t = new FaceTracks(new LivePersons(), { maxFaces: 1 });
    run(t, 10, () => [A()]);
    const p = t.views()[0].person;
    run(t, 5, () => [lmAt(0.8, 0.5, 0.2)], 400);
    expect(t.views().map((v) => v.person)).toEqual([p]);
    expect(t.views()[0].box.x).toBeGreaterThan(0.6);
  });
  it(`tracks up to MAX_LIVE_FACES (${MAX_LIVE_FACES}); when full a new face evicts the oldest held track early, its person released`, () => {
    const s = editedAll();
    const t = new FaceTracks(s);
    const row = () => Array.from({ length: 10 }, (_, i) => lmAt(0.05 + i * 0.09, 0.5, 0.05));
    let now = run(t, 5, row);
    expect(t.views()).toHaveLength(10);
    const first = [...t.views()].sort((a, b) => a.box.x - b.box.x)[0];
    now = run(t, 3, () => row().slice(1), now + 33);
    run(t, 2, () => [...row().slice(1), lmAt(0.5, 0.15, 0.05)], now + 33);
    expect(t.views()).toHaveLength(10);
    expect(t.views().some((v) => v.id === first.id)).toBe(false);
    expect(s.claim(first.box, W / H, now + 200)).toBe(first.person);
  });
  it('a dropped track, and every track at reset(), goes to the away pool when edited (§7.5)', () => {
    const s = editedAll();
    const t = new FaceTracks(s);
    run(t, 5, () => [A(), B()]);
    const [va, vb] = [...t.views()].sort((a, b) => a.box.x - b.box.x);
    run(t, 40, () => [A()], 200);
    expect(t.views()).toHaveLength(1);
    t.reset();
    expect(t.views()).toHaveLength(0);
    expect(s.claim(va.box, W / H, 1700)).toBe(va.person);
    expect(s.claim(vb.box, W / H, 1700)).toBe(vb.person);
  });
  it('a face draws its person only when edited: untouched faces stay at weight 0 whoever is selected (§3.3)', () => {
    const s = new LivePersons();
    const t = new FaceTracks(s);
    run(t, 10, () => [A(), B(0.19)]);
    expect(t.views().map((v) => v.weight)).toEqual([0, 0]);
    const vb = t.views().find((v) => v.box.x > 0.5)!;
    s.write([vb.person], naturalPerson());
    run(t, 6, () => [A(), B(0.19)], 400);
    for (const v of t.views()) expect([v.edited, v.weight]).toEqual(v.person === vb.person ? [true, 1] : [false, 0]);
  });
});

describe('FaceTracks on the group path: a call matches and misses only what its view holds (§6.6)', () => {
  const scope = (x0: number, x1: number): DetectScope => {
    const inside = (b: Rect) => b.x >= x0 && b.x + b.w <= x1;
    return { name: 'tile', view: { x: x0, y: 0, w: x1 - x0, h: 1 }, matchable: inside, missable: inside };
  };
  it('a call whose view does not hold a track neither misses nor ages it', () => {
    const t = new FaceTracks(editedAll());
    run(t, 5, () => [A(), B()]);
    for (let i = 0, now = 200; i < 60; i++, now += 33) {
      t.detect([A()], now, W, H, scope(0, 0.5));
      t.step(33, now);
    }
    expect(t.views()).toHaveLength(2);
    expect(t.views().find((v) => v.box.x > 0.5)!.present).toBe(true);
    expect(t.views().find((v) => v.box.x < 0.5)!.view).toBe('tile');
  });
  it('a track missed by a view that holds it is held, then dropped', () => {
    const t = new FaceTracks(editedAll());
    run(t, 5, () => [A(), B()]);
    for (let i = 0, now = 200; i < 40; i++, now += 33) {
      t.detect([A()], now, W, H, scope(0, 1));
      t.step(33, now);
    }
    expect(t.views()).toHaveLength(1);
  });
  it.each(['dropped after the hold', 'reset (a pause)'] as const)(
    'a track’s person is released with the path that last found it (K22): %s on the other path, they are back when it returns',
    (how) => {
      const s = new LivePersons();
      const t = new FaceTracks(s);
      const whole = scope(0, 1);
      let now = 0;
      s.setPath('group', now);
      for (let i = 0; i < 5; i++, now += 33) {
        t.detect([A(), B()], now, W, H, whole);
        t.step(33, now);
      }
      const b = t.views().find((v) => v.box.x > 0.5)!.person;
      s.write([b], naturalPerson());
      s.setPath('solo', now); // the solo path cannot see B
      const frames = how === 'reset (a pause)' ? 3 : 200;
      for (let i = 0; i < frames; i++, now += 33) {
        t.detect([A()], now, W, H);
        t.step(33, now);
      }
      if (how === 'reset (a pause)') t.reset();
      else expect(t.views()).toHaveLength(1);
      now += 10_000;
      s.setPath('group', now);
      t.detect([A(), B()], now, W, H, whole);
      expect(t.views().find((v) => v.box.x > 0.5)!.person).toBe(b);
      expect(s.edited(b)).toBe(true);
    },
  );
  it('a face cut by the view edge starts no track unless it matches one', () => {
    const t = new FaceTracks(new LivePersons());
    t.detect([lmAt(0.5, 0.5, 0.2)], 0, W, H, scope(0, 0.55));
    expect(t.views()).toHaveLength(0);
  });
  it('a face that stops near the crop edge keeps its person: the whole view matches a track predicted across the edge (E5, group_move.y4m)', () => {
    // the 3:4 crop of 1280 × 720 (x 0.289–0.711), the front camera's views; a face 0.14 wide walks right at the clip's
    // swap speed and stops 0.03 inside the crop's right edge; a whole-view call every 460 ms (SwiftShader's cadence)
    const l = layoutViews(W, H, { x: 370, y: 0, w: 540, h: 720 }, 'user', 'camera');
    const whole = viewScope(l.whole, l);
    const t = new FaceTracks(editedAll());
    const at = (ms: number) => Math.min(0.611, 0.45 + 0.000144 * ms);
    let p: number | null = null;
    for (let ms = 0; ms <= 3220; ms += 460) {
      t.detect([lmAt(at(ms), 0.5, 0.14)], ms, W, H, whole);
      t.step(460, ms);
      p ??= t.views()[0].person;
    }
    expect(t.views().map((v) => [v.person, v.present])).toEqual([[p, true]]);
  });
  it('a face cut by the crop edge stays one track: the tile at that edge matches it, not a second person (detector.spec.ts D2)', () => {
    // D2's face B: 0.155 wide, its top above the frame (the box clamps to y 0), the front camera's crop x 0.289–0.711;
    // the box's centre jitters with the clamped height, so the predicted box dips above the crop; the whole view three
    // calls in four, the scan of t0,0 (y 0–540 px, from the crop's top) every fourth (LIVE_SCAN_EVERY)
    const l = layoutViews(W, H, { x: 370, y: 0, w: 540, h: 720 }, 'user', 'camera');
    const [whole, tile] = [viewScope(l.whole, l), viewScope(l.tiles[0], l)];
    const t = new FaceTracks(new LivePersons());
    for (let i = 0, ms = 0; i < 80; i++, ms += 40) {
      t.detect([lmAt(0.63, 0.03 + 0.004 * Math.sin(i * 1.3), 0.155)], ms, W, H, i % 4 === 3 ? tile : whole);
      t.step(40, ms);
    }
    expect(t.views()[0].rawBox.y).toBe(0); // the detection is cut by the frame's top edge
    expect(t.views()).toHaveLength(1);
  });
});

describe('the camera frame on persons: liveFrame → skinMaxima → planFrame (camera per-person spec §8, A2, A3)', () => {
  const look = splitLegacy(applyPreset('refined'));
  const smooth = look.person.values['skin.smooth'];
  const rosy = ROSY_MAX_OPACITY * look.person.values['skin.rosy'];
  /** the engine's job() for the plan, and the 磨皮 / 紅潤 strength the composite gives a pixel outside every face */
  const frameOf = (t: FaceTracks, s: LivePersons) => {
    const f = liveFrame(t.views(), t.anyFace, look.photo, s);
    const m = skinMaxima(f.faces.map((x) => ({ weight: x.weight, smooth: x.person.values['skin.smooth'], rosy: x.person.values['skin.rosy'] })), f.globalSkin);
    const skin = skinUniformsFor(f.photo, m.S, m.R, false);
    const faces = f.faces.map((x) => ({ weight: x.weight, reshape: reshapeUniforms(x.person.values, x.weight), makeup: makeupUniformsFor(x.person, x.weight) }));
    const plan = planFrame({ faces, maskClear: m.clear, matchGpupixel: false, skin, adjust: { on: false } }, true, false);
    // without a mask pass the composite reads the white texture (mask 1); with one, the clear outside every face
    const bg = [plan.mask ? skin.smooth * m.clear[0] : skin.smooth, plan.mask ? skin.rosy * m.clear[1] : skin.rosy];
    return { f, m, plan, bg };
  };
  const big = () => lmAt(0.3, 0.5, 0.25);
  const small = () => lmAt(0.7, 0.5, 0.2);

  it('a pinned edited face leaving beside an untouched one: the background 磨皮／紅潤 stay 0 on every frame; once it faded out the plan is the composite pass alone (A3)', () => {
    const s = new LivePersons();
    const t = new FaceTracks(s);
    let now = run(t, 20, () => [big(), small()]);
    const leaver = t.views().find((v) => v.box.x > 0.5)!.person;
    s.pin(leaver);
    s.edit(look.person);
    now = run(t, 10, () => [big(), small()], now + 33);
    expect(frameOf(t, s).f.faces.map((x) => x.weight)).toEqual([1, 0]);
    for (let i = 0; i < 75; i++) {
      now += 33;
      t.detect([big()], now, W, H);
      t.step(33, now);
      const { f, bg } = frameOf(t, s);
      expect(f.globalSkin!.weight).toBe(0);
      expect(bg).toEqual([0, 0]);
    }
    // the edited face was held, faded out and dropped (released to the away pool); the untouched face is listed at 0
    const { f, plan } = frameOf(t, s);
    expect(f.faces.map((x) => x.weight)).toEqual([0]);
    expect(plan).toEqual({ mask: false, makeup: false, reshape: false, mean: false, adjust: false });
  });

  it('with an ambient person (基本模式’s all-skin person), one face leaving hands its 磨皮／紅潤 to the background as v0.3 did', () => {
    const s = editedAll(look.person);
    s.setAmbient(look.person);
    const t = new FaceTracks(s);
    let now = run(t, 20, () => [big()]);
    for (let i = 0; i < 40; i++) {
      now += 33;
      t.detect([], now, W, H);
      t.step(33, now);
      const { f, plan, bg } = frameOf(t, s);
      const g = f.globalSkin!.weight;
      expect(g).toBeCloseTo(1 - t.anyFace, 12);
      expect(bg[0]).toBeCloseTo(g * smooth, 9);
      expect(bg[1]).toBeCloseTo(g * rosy, 9);
      if (g === 1) expect(plan.mask).toBe(false);
    }
    expect(frameOf(t, s).f.faces).toEqual([]);
  });
});

describe('cameraTapAction (S §2.5)', () => {
  it('every row of the table', () => {
    expect(cameraTapAction(1, 1, 'auto', false)).toEqual({ kind: 'collapse' });
    expect(cameraTapAction(2, 2, 'auto', true)).toEqual({ kind: 'select', id: 2, allOff: true });
    expect(cameraTapAction(2, 2, 'auto', false)).toEqual({ kind: 'select', id: 2, allOff: false });
    expect(cameraTapAction(2, 3, 1, false)).toEqual({ kind: 'select', id: 2, allOff: false });
    expect(cameraTapAction(2, 2, 2, false)).toEqual({ kind: 'collapse' });
    expect(cameraTapAction(null, 2, 2, false)).toEqual({ kind: 'collapse' });
    expect(cameraTapAction(null, 3, 'auto', true)).toEqual({ kind: 'collapse' });
  });
});

describe('cover mapping (S §3.4 C1)', () => {
  const rect = { left: 10, top: 20, width: 390, height: 520 };
  it('a tap maps to unmirrored video UV and back', () => {
    for (const mirrored of [false, true]) {
      const [x, y] = videoToFrame(0.6, 0.4, rect, 1280, 720, mirrored);
      const r = coverTapUv(rect.left + x, rect.top + y, rect, 1280, 720, mirrored);
      expect(r.u).toBeCloseTo(0.6, 9);
      expect(r.v).toBeCloseTo(0.4, 9);
    }
  });
  it('the front camera mirrors u; 44 pt in video UV at the cover scale', () => {
    const s = Math.max(390 / 1280, 520 / 720);
    const r = coverTapUv(rect.left + 195, rect.top + 100, rect, 1280, 720, true);
    expect(r.u).toBeCloseTo(0.5, 9);
    expect(r.minW).toBeCloseTo(44 / (s * 1280), 9);
    expect(r.minH).toBeCloseTo(44 / (s * 720), 9);
  });
});

describe('ChipGate (S §2.5: 300 ms on, 1200 ms off, never off while 全部套用 is on)', () => {
  it('debounces both ways and does not blink with a flickering second face (Review Focus #4)', () => {
    const g = new ChipGate();
    expect(g.update(2, false, 0)).toBe(false);
    expect(g.update(2, false, 250)).toBe(false);
    expect(g.update(2, false, 300)).toBe(true);
    for (let t = 400; t < 4000; t += 100) expect(g.update(t % 200 ? 1 : 2, false, t)).toBe(true);
    expect(g.update(1, false, 4100)).toBe(true);
    expect(g.update(1, false, 5300)).toBe(false);
    expect(g.update(0, true, 5400)).toBe(true);
    expect(g.update(0, true, 9000)).toBe(true);
  });
  it('a flicker that never holds two faces for 300 ms never shows it', () => {
    const g = new ChipGate();
    for (let t = 0; t < 3000; t += 100) expect(g.update(t % 200 ? 1 : 2, false, t)).toBe(false);
  });
});
