import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { splitLegacy } from '../edit/legacy';
import { applyPreset } from '../engine/params';
import { makeupUniformsFor } from '../engine/passes/makeup';
import { reshapeUniforms } from '../engine/passes/reshape';
import { planFrame } from '../engine/pipeline';
import { ROSY_MAX_OPACITY, skinMaxima, skinUniformsFor } from '../engine/uniforms';
import { adapt } from '../tracking/adapter111';
import type { Landmarks478 } from '../types';
import { liveFrame } from './live';
import { FaceWeightEaser } from './liveCore';
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
function run(t: FaceTracks, frames: number, at: (i: number) => readonly Landmarks478[] | null, t0 = 0, all = false): number {
  let now = t0;
  for (let i = 0; i < frames; i++) {
    now = t0 + i * 33;
    t.detect(at(i), now, W, H);
    t.step(33, all, now);
  }
  return now;
}
const A = (dx = 0) => lmAt(0.3 + dx, 0.5, 0.2);
const B = (w = 0.2) => lmAt(0.7, 0.5, w);

describe('FaceTracks (S §3.4 T4)', () => {
  it('matches by IoU across frames, and by centre when the face doubles in size at once (IoU 0.25); ids stay', () => {
    // two faces, so the one-track-one-face fallback cannot pair the doubled face: only the centre rule can
    const t = new FaceTracks();
    run(t, 3, (i) => [A(i * 0.01), B()]);
    const ids = t.views().map((v) => v.id).sort((a, b) => a - b);
    expect(ids).toHaveLength(2);
    run(t, 1, () => [lmAt(0.32, 0.5, 0.4), B()], 200);
    expect(t.views().map((v) => v.id).sort((a, b) => a - b)).toEqual(ids);
    expect(t.views().every((v) => v.present)).toBe(true);
  });
  it('one face that doubles in size at once keeps its id', () => {
    const t = new FaceTracks();
    run(t, 3, (i) => [A(i * 0.01)]);
    const id = t.views()[0].id;
    run(t, 1, () => [lmAt(0.32, 0.5, 0.4)], 200);
    expect(t.views().map((v) => v.id)).toEqual([id]);
  });
  it('two detections converged on one face are one track', () => {
    const t = new FaceTracks();
    run(t, 5, () => [A(), A(0.002)]);
    expect(t.views()).toHaveLength(1);
  });
  it('no answer (null) keeps the tracks and the selection; the weights ease out', () => {
    const t = new FaceTracks();
    run(t, 10, () => [A(), B()]);
    const b = t.views().find((v) => v.box.x > 0.5)!.id;
    t.select(b);
    run(t, 10, () => [A(), B()], 400);
    run(t, 60, () => null, 800);
    expect(t.views()).toHaveLength(2);
    expect(t.selection()).toBe(b);
    expect(t.views().every((v) => v.weight === 0)).toBe(true);
  });
  it('a missing track is held for LOST_HOLD_MS, then dropped; a pinned selection returns to auto', () => {
    const t = new FaceTracks();
    run(t, 10, () => [A(), B()]);
    const b = t.views().find((v) => v.box.x > 0.5)!.id;
    t.select(b);
    run(t, 25, () => [A()], 400); // 800 ms without B
    expect(t.views()).toHaveLength(2);
    run(t, 10, () => [A()], 1300);
    expect(t.views()).toHaveLength(1);
    expect(t.selection()).toBe('auto');
  });
  it('Review Focus #4: a no-answer stretch longer than LOST_HOLD_MS (a context loss) does not age the hold (S §3.4 T4)', () => {
    const t = new FaceTracks();
    run(t, 10, () => [A(), B()]);
    const b = t.views().find((v) => v.box.x > 0.5)!.id;
    t.select(b);
    run(t, 90, () => null, 400); // 3 s without an answer
    run(t, 15, () => [A()], 3400); // answers again, B missed for the first 460 ms
    expect(t.views()).toHaveLength(2);
    expect(t.selection()).toBe(b);
    run(t, 5, () => [A(), B()], 3900); // found again near its last centre: the same track, still pinned
    expect(t.beautified()!.id).toBe(b);
  });
  it('auto picks the largest and switches only after another stays ≥ 1.2× larger for 500 ms (A7)', () => {
    const t = new FaceTracks();
    run(t, 10, () => [A(), B(0.15)]);
    const a = t.beautified()!.id;
    expect(t.views().find((v) => v.id === a)!.box.x).toBeLessThan(0.5);
    let now = run(t, 12, () => [A(), B(0.24)], 400); // 1.44× for 363 ms: not yet
    expect(t.beautified()!.id).toBe(a);
    now = run(t, 10, () => [A(), B(0.24)], now + 33); // the smoothed box needs a frame or two to pass 1.2×
    expect(t.beautified()!.id).not.toBe(a);
    const t2 = new FaceTracks();
    run(t2, 10, () => [A()]); // A is the auto pick first (B(0.21) is the largest from frame 0 otherwise)
    run(t2, 30, () => [A(), B(0.21)], 400); // then a face 1.1× larger for 1 s: never
    expect(t2.views().find((v) => v.id === t2.beautified()!.id)!.box.x).toBeLessThan(0.5);
  });
  it('Review Focus #4: a second face flickering in every other detection never takes the beautify, even when larger', () => {
    const t = new FaceTracks();
    run(t, 10, () => [A()]);
    const a = t.beautified()!.id;
    run(t, 120, (i) => (i % 2 ? [A(), B(0.3)] : [A()]), 400);
    expect(t.beautified()!.id).toBe(a);
  });
  it('a selection switch crossfades over 150 ms; the presence easer follows presence only', () => {
    const t = new FaceTracks();
    // B slightly smaller, so auto picks A deterministically (two equal boxes differ only by float rounding)
    run(t, 10, () => [A(), B(0.19)]);
    const [va, vb] = [...t.views()].sort((x, y) => x.box.x - y.box.x);
    expect([va.weight, vb.weight]).toEqual([1, 0]);
    expect(vb.presence).toBe(1);
    t.select(vb.id);
    t.detect([A(), B()], 400, W, H);
    t.step(75, false, 475);
    const mid = t.views();
    expect(mid.find((v) => v.id === va.id)!.weight).toBeGreaterThan(0);
    expect(mid.find((v) => v.id === vb.id)!.weight).toBeGreaterThan(0);
    t.step(100, false, 575);
    expect(t.views().find((v) => v.id === vb.id)!.weight).toBe(1);
    expect(t.views().find((v) => v.id === va.id)!.weight).toBe(0);
  });
  it('one face: the weight and anyFace equal v0.3’s single easer, frame by frame (live parity)', () => {
    const t = new FaceTracks();
    const e = new FaceWeightEaser();
    const seq = [1, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 1];
    seq.forEach((present, i) => {
      t.detect(present ? [A()] : [], i * 33, W, H);
      t.step(33, false, i * 33);
      const want = e.update(present === 1, 33);
      expect(t.anyFace).toBe(want);
      expect(t.views()[0]?.weight ?? 0).toBe(want);
    });
  });
  it.each([3, 1])(
    'one face that comes back far from where it was (after no answer, after a [] gap, or in one jump) stays one track with v0.3’s weight (maxFaces %i, S §1.2 item 1)',
    (maxFaces) => {
      const far = [lmAt(0.6, 0.5, 0.2)];
      const near = [lmAt(0.3, 0.5, 0.2)];
      const seqs: (readonly Landmarks478[] | null)[][] = [
        [...Array(10).fill(near), ...Array(60).fill(null), ...Array(20).fill(far)],
        [...Array(10).fill(near), ...Array(10).fill([]), ...Array(20).fill(far)],
        [...Array(10).fill(near), ...Array(20).fill(far)],
      ];
      for (const seq of seqs) {
        const t = new FaceTracks({ maxFaces });
        const e = new FaceWeightEaser();
        seq.forEach((lms, i) => {
          t.detect(lms, i * 33, W, H);
          t.step(33, false, i * 33);
          const want = e.update(lms !== null && lms.length > 0, 33);
          expect(t.views()).toHaveLength(1);
          expect(t.views()[0].weight).toBe(want);
          expect(t.anyFace).toBe(want);
        });
        expect(t.views()[0].box.x).toBeGreaterThan(0.45);
        expect(cameraTapAction(t.views()[0].id, t.views().length, t.selection(), false)).toEqual({ kind: 'collapse' });
      }
    },
  );
  it('with maxFaces 1 the smoother is bypassed: the shown face is the raw one (v0.3)', () => {
    const t = new FaceTracks({ maxFaces: 1 });
    run(t, 3, (i) => [A(i * 0.01)]);
    expect(Array.from(t.views()[0].face.pts111)).toEqual(Array.from(adapt(A(0.02), W, H).pts111));
  });
  it('hitTest: boxes grown to the 44 pt minimum, nearest centre among several', () => {
    const t = new FaceTracks();
    run(t, 5, () => [A(), B()]);
    const [va, vb] = [...t.views()].sort((x, y) => x.box.x - y.box.x);
    expect(t.hitTest(va.box.x + va.box.w / 2, 0.5, 0.01, 0.01)).toBe(va.id);
    expect(t.hitTest(0.5, 0.5, 0.01, 0.01)).toBeNull();
    expect(t.hitTest(0.5, 0.5, 0.9, 0.9)).not.toBeNull();
    expect(t.hitTest(vb.box.x + vb.box.w / 2, 0.5, 0.9, 0.9)).toBe(vb.id);
  });
});

describe('the camera frame on tracks: liveFrame → skinMaxima → planFrame (S §3.3, A2)', () => {
  const look = splitLegacy(applyPreset('refined'));
  const smooth = look.person.values['skin.smooth'];
  const rosy = ROSY_MAX_OPACITY * look.person.values['skin.rosy'];
  /** the engine's job() for the plan, and the 磨皮 / 紅潤 strength the composite gives a pixel outside every face */
  const frameOf = (t: FaceTracks) => {
    const f = liveFrame(t.views(), t.anyFace, look);
    const m = skinMaxima(f.faces.map((x) => ({ weight: x.weight, smooth: x.person.values['skin.smooth'], rosy: x.person.values['skin.rosy'] })), f.globalSkin);
    const skin = skinUniformsFor(f.photo, m.S, m.R, false);
    const faces = f.faces.map((x) => ({ weight: x.weight, reshape: reshapeUniforms(x.person.values, x.weight), makeup: makeupUniformsFor(x.person, x.weight) }));
    const plan = planFrame({ faces, maskClear: m.clear, matchGpupixel: false, skin }, true, false);
    // without a mask pass the composite reads the white texture (mask 1); with one, the clear outside every face
    const bg = [plan.mask ? skin.smooth * m.clear[0] : skin.smooth, plan.mask ? skin.rosy * m.clear[1] : skin.rosy];
    return { f, m, plan, bg };
  };
  const big = () => lmAt(0.3, 0.5, 0.25);
  const small = () => lmAt(0.7, 0.5, 0.2);

  it.each(['auto', 'pinned'] as const)(
    'the beautified track (%s) lost beside a present face: the background keeps the global skin weight on every frame',
    (mode) => {
      const t = new FaceTracks();
      let now = run(t, 20, () => [big(), small()]);
      // auto: the larger face is beautified; pinned: the smaller one. That face leaves, the other stays
      const stayer = mode === 'auto' ? small : big;
      if (mode === 'pinned') t.select(t.views().find((v) => v.box.x > 0.5)!.id);
      now = run(t, 10, () => [big(), small()], now + 33);
      let held = 0;
      for (let i = 0; i < 75; i++) {
        now += 33;
        t.detect([stayer()], now, W, H);
        t.step(33, false, now);
        const { f, m, plan, bg } = frameOf(t);
        const g = f.globalSkin!.weight;
        expect(g).toBe(0);
        expect(bg[0]).toBeCloseTo(g * smooth, 9);
        expect(bg[1]).toBeCloseTo(g * rosy, 9);
        if (f.faces.length > 0 && f.faces.every((x) => x.weight === 0)) {
          // the lost target is held (faded out of the list) and still the target: the face in view is listed at weight 0,
          // nobody is beautified, so nothing is smoothed
          held++;
          expect(plan.mask).toBe(true);
          expect(m.clear).toEqual([0, 0]);
        }
      }
      // the hold window happened (≈ 1 s minus the 150 ms ease-out), and the face that stayed was handed the look
      expect(held).toBeGreaterThan(20);
      expect(frameOf(t).f.faces.map((x) => x.weight)).toEqual([1]);
    },
  );

  it('one face (v0.3): the background follows 1 − weight while it leaves, and the mask pass ends with it', () => {
    const t = new FaceTracks();
    let now = run(t, 20, () => [big()]);
    for (let i = 0; i < 40; i++) {
      now += 33;
      t.detect([], now, W, H);
      t.step(33, false, now);
      const { f, plan, bg } = frameOf(t);
      const g = f.globalSkin!.weight;
      expect(bg[0]).toBeCloseTo(g * smooth, 9);
      expect(bg[1]).toBeCloseTo(g * rosy, 9);
      if (g === 1) expect(plan.mask).toBe(false);
    }
    expect(frameOf(t).f.faces).toEqual([]);
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
