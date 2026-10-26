import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LOST_HOLD_MS, MAX_LIVE_FACES } from '../config/limits';
import { boxIoU, sameHead } from '../detect/faces';
import { splitLegacy } from '../edit/legacy';
import { naturalPerson, personFromPreset } from '../edit/state';
import { applyPreset } from '../engine/params';
import { ovalBox } from '../engine/passes/faceCap';
import { makeupUniformsFor } from '../engine/passes/makeup';
import { reshapeUniforms } from '../engine/passes/reshape';
import { planFrame } from '../engine/pipeline';
import { ROSY_MAX_OPACITY, skinMaxima, skinUniformsFor } from '../engine/uniforms';
import { adapt } from '../tracking/adapter111';
import { FACE_OVAL } from '../tracking/faceOval';
import type { Landmarks478, PersonParams, Rect } from '../types';
import { liveFrame } from './live';
import { FaceWeightEaser } from './liveCore';
import { LivePersons } from './livePersons';
import { layoutViews, shutterScope, viewScope, type DetectScope } from './liveViews';
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
/**
 * `lm`'s mesh with its outline (FACE_OVAL, the points its oval box is taken from) drawn in × sx toward its right edge
 * and × sy toward its middle in height: one head's mesh boxed smaller, as a find that fits part of the face, its eyes,
 * nose and mouth where they were (round-6 review H2)
 */
function outlineIn(lm: Landmarks478, sx: number, sy: number): Landmarks478 {
  const p = lm.points.slice();
  const xs = FACE_OVAL.map((i) => p[i * 3]);
  const ys = FACE_OVAL.map((i) => p[i * 3 + 1]);
  const x1 = Math.max(...xs);
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  for (const i of FACE_OVAL) {
    p[i * 3] = x1 - (x1 - p[i * 3]) * sx;
    p[i * 3 + 1] = cy + (p[i * 3 + 1] - cy) * sy;
  }
  return { points: p };
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
  it('round 3 (E5): a no-answer leaves a found track unseen (stale) and a held one held: known missing, its hold paused', () => {
    const s = new LivePersons();
    const t = new FaceTracks(s);
    run(t, 10, () => [A(), B()]);
    run(t, 9, () => [A()], 330); // B missed for 300 ms: held
    const state = () => [...t.views()].sort((x, y) => x.box.x - y.box.x).map((v) => [v.present, v.stale]);
    expect(state()).toEqual([[true, false], [false, false]]);
    run(t, 30, () => null, 627); // a no-answer stretch of 1 s (the rebuild throttle): A unseen, B still known missing
    expect(state()).toEqual([[false, true], [false, false]]);
    // the hold resumes where it stopped (330 ms of it spent): still held 594 ms after the answers resume, dropped once
    // the other 670 ms have run
    run(t, 19, () => [A()], 1617);
    expect(state()).toEqual([[true, false], [false, false]]);
    run(t, 4, () => [A()], 2244);
    expect(state()).toEqual([[true, false]]);
    // on the group path too: B stays known missing to a call that cannot see B (I3)
    const g = new FaceTracks(new LivePersons());
    const inside = (b: Rect) => b.x + b.w <= 0.5;
    const tile: DetectScope = { name: 'tile', view: { x: 0, y: 0, w: 0.5, h: 1 }, matchable: inside, missable: inside };
    g.detect([A(), B()], 0, W, H);
    g.detect([A()], 33, W, H); // B missed by a call that sees it
    g.detect(null, 66, W, H);
    g.detect([A()], 99, W, H, tile); // t0's call: it cannot see B
    expect([...g.views()].sort((x, y) => x.box.x - y.box.x).map((v) => [v.present, v.stale])).toEqual([[true, false], [false, false]]);
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
  it('C1: a person coming back where they left while a neighbour is briefly held is claimed, not given the neighbour’s track: nobody swaps (§7.4, A2)', () => {
    // X at 0.40 and Z at 0.52, 1.2 widths apart (inside REID_DIST of each other); Z steps out past the hold (away), X
    // looks down for 200 ms (held), Z comes back to her spot: one decision over X's held track and Z's away entry
    const s = new LivePersons();
    const t = new FaceTracks(s);
    const X = () => lmAt(0.4, 0.5, 0.1);
    const Z = () => lmAt(0.52, 0.5, 0.1);
    let now = run(t, 10, () => [X(), Z()]);
    const [px, pz] = [...t.views()].sort((a, b) => a.box.x - b.box.x).map((v) => v.person);
    s.write([px], naturalPerson());
    s.write([pz], personFromPreset('refined', 1));
    now = run(t, 45, () => [X()], now + 33); // Z away 1.5 s: dropped, her person in the away pool
    expect(t.views().map((v) => v.person)).toEqual([px]);
    now = run(t, 6, () => [], now + 33); // X held 200 ms
    now = run(t, 1, () => [Z()], now + 33); // Z back first
    now = run(t, 5, () => [X(), Z()], now + 33); // then X
    const byPerson = new Map(t.views().map((v) => [v.person, v.box.x + v.box.w / 2]));
    expect(byPerson.get(px)!).toBeCloseTo(0.4, 1);
    expect(byPerson.get(pz)!).toBeCloseTo(0.52, 1);
    expect(t.views()).toHaveLength(2);
    expect(s.params(px)).toEqual(naturalPerson());
    expect(s.params(pz)).toEqual(personFromPreset('refined', 1));
  });
  it('C1: a detection about as near a held track as an away person is a new person at 原圖; both keep their params', () => {
    const s = new LivePersons();
    const t = new FaceTracks(s);
    let now = run(t, 10, () => [lmAt(0.3, 0.5, 0.1), lmAt(0.5, 0.5, 0.1)]);
    const [px, pz] = [...t.views()].sort((a, b) => a.box.x - b.box.x).map((v) => v.person);
    s.write([px, pz], naturalPerson());
    now = run(t, 45, () => [lmAt(0.3, 0.5, 0.1)], now + 33); // Z away
    now = run(t, 3, () => [], now + 33); // X held
    run(t, 1, () => [lmAt(0.4, 0.5, 0.1)], now + 33); // halfway between X's held track and Z's last place
    const fresh = t.views().find((v) => v.present)!;
    expect([fresh.person === px, fresh.person === pz, fresh.edited]).toEqual([false, false, false]);
    expect(t.views().find((v) => v.person === px)).toMatchObject({ present: false }); // X still held
    expect(s.claim(t.views().find((v) => v.person === px)!.box, W / H, now + 100)).not.toBe(pz); // Z still away, not claimed by the tie
  });
  it('C1, Codex #1: with every track slot taken, a detection equally near two held tracks stays a new person at 原圖 after the eviction releases one of them', () => {
    const s = new LivePersons();
    const t = new FaceTracks(s);
    const top = () => Array.from({ length: 8 }, (_, i) => lmAt(0.08 + i * 0.12, 0.2, 0.05));
    const X = () => lmAt(0.4, 0.7, 0.05);
    const Y = () => lmAt(0.48, 0.7, 0.05);
    let now = run(t, 5, () => [...top(), X(), Y()]);
    expect(t.views()).toHaveLength(MAX_LIVE_FACES);
    const near = (cx: number) => t.views().find((v) => v.box.y > 0.5 && Math.abs(v.box.x + v.box.w / 2 - cx) < 0.02)!.person;
    const [px, py] = [near(0.4), near(0.48)];
    s.write([px], naturalPerson());
    s.write([py], personFromPreset('refined', 1));
    now = run(t, 2, () => [...top(), Y()], now + 33); // X held first (the oldest held track)
    now = run(t, 2, () => [...top()], now + 33); // then Y
    run(t, 1, () => [...top(), lmAt(0.44, 0.7, 0.05)], now + 33); // halfway between them
    const fresh = t.views().find((v) => v.present && v.box.y > 0.5)!;
    expect([fresh.person === px, fresh.person === py, fresh.edited]).toEqual([false, false, false]);
    expect(t.views()).toHaveLength(MAX_LIVE_FACES);
    expect(t.views().some((v) => v.person === py)).toBe(true); // Y held still
  });
  it('round-1 review C21: every slot taken and the away pool full, ten people coming back each get their own person: the track evicted for one does not push them out of the pool (§7.3 item 5)', () => {
    const s = new LivePersons();
    const t = new FaceTracks(s);
    // two groups of ten, each face of one farther from every face of the other than §7.4's 1.5 widths
    const first = () => Array.from({ length: 10 }, (_, i) => lmAt(0.23 + (i % 5) * 0.18, i < 5 ? 0.5 : 0.9, 0.08));
    const second = () => Array.from({ length: 10 }, (_, i) => lmAt(0.14 + (i % 5) * 0.18, i < 5 ? 0.3 : 0.7, 0.08));
    let now = run(t, 5, first);
    const ones = t.views().map((v) => v.person);
    s.write(ones, naturalPerson());
    now = run(t, 5, second, now + 33); // the first group leaves: each face of the second evicts one of its held tracks
    const twos = t.views().map((v) => v.person);
    expect(twos.some((p) => ones.includes(p))).toBe(false);
    s.write(twos, personFromPreset('refined', 1));
    run(t, 5, first, now + 33); // back within the grace: ten away in the pool, each face evicting a held track of the second
    const back = t.views().map((v) => v.person);
    expect([...back].sort((a, b) => a - b)).toEqual([...ones].sort((a, b) => a - b));
    expect(back.every((p) => JSON.stringify(s.params(p)) === JSON.stringify(naturalPerson()))).toBe(true);
  });
  it('round-2 review D4: every slot taken and the away pool full, a larger newcomer and an away person coming back in one call: she gets her own person (every take before any eviction)', () => {
    const first = () => Array.from({ length: 10 }, (_, i) => lmAt(0.23 + (i % 5) * 0.18, i < 5 ? 0.5 : 0.9, 0.08));
    const second = () => Array.from({ length: 10 }, (_, i) => lmAt(0.14 + (i % 5) * 0.18, i < 5 ? 0.3 : 0.7, 0.08));
    // each of the ten in turn comes back, so one of them is the pool's oldest entry, the one a release into the full
    // pool evicts
    for (let k = 0; k < 10; k++) {
      const s = new LivePersons();
      const t = new FaceTracks(s);
      let now = run(t, 5, first);
      s.write(t.views().map((v) => v.person), naturalPerson());
      now = run(t, 5, second, now + 33); // the first group away (edited): the pool full
      s.write(t.views().map((v) => v.person), personFromPreset('refined', 1));
      const backBox = ovalBox(adapt(first()[k], W, H));
      const [away] = s.awayCandidates(backBox, W / H, now + 33).map((c) => c.id);
      now = run(t, 3, () => second().slice(0, 8), now + 33); // two of the second group leave: held, evictable
      // one call: the eight, a newcomer far from everyone and larger than her (so started first), and her, back in place
      run(t, 1, () => [...second().slice(0, 8), lmAt(0.95, 0.1, 0.09), first()[k]], now + 33);
      const v = t.views().find((x) => boxIoU(x.rawBox, backBox) > 0.9)!;
      expect([k, v.person, v.edited]).toEqual([k, away, true]);
      expect(s.params(away)).toEqual(naturalPerson());
    }
  });
  describe('round-3 review E3, Codex: a track whose hold runs out releases nobody before the call has taken everyone it decided (I4)', () => {
    // the whole frame as one group-path view, which matches and misses every track: the same rule on both paths
    const all: DetectScope = { name: 'whole', view: { x: 0, y: 0, w: 1, h: 1 }, matchable: () => true, missable: () => true };
    const paths = [
      ['the solo path', undefined],
      ['the group path', all],
    ] as const;
    const at = (lms: readonly Landmarks478[]) => ovalBox(adapt(lms[0], W, H));
    const id = (t: FaceTracks, box: Rect) => t.views().find((v) => boxIoU(v.rawBox, box) > 0.9)!.person;
    it.each(paths)('%s: ten edited people away (the pool full), a newer edited track past its hold as the oldest of them comes back in place: she keeps her person and her edits', (_, scope) => {
      const s = new LivePersons();
      const t = new FaceTracks(s);
      let now = 0;
      const call = (lms: readonly Landmarks478[]) => {
        t.detect(lms, now, W, H, scope);
        t.step(33, now);
        now += 33;
      };
      const F = (i: number) => lmAt(0.08 + (i % 5) * 0.2, i < 5 ? 0.25 : 0.75, 0.06);
      const ten = Array.from({ length: 10 }, (_, i) => F(i));
      for (let i = 0; i < 5; i++) call(ten);
      s.write(t.views().map((v) => v.person), naturalPerson());
      const ids = ten.map((f) => id(t, at([f])));
      for (let k = 1; k <= 10; k++) call(ten.slice(k)); // F0 leaves first: the pool's oldest entry
      for (let i = 0; i < 35; i++) call([]); // all ten past the hold: away, in grace, the pool full
      expect(t.views()).toHaveLength(0);
      for (let i = 0; i < 3; i++) call([lmAt(0.5, 0.5, 0.06)]); // T, edited 精緻, then held
      const [tv] = t.views();
      s.write([tv.person], personFromPreset('refined', 1));
      while (now - tv.seen <= LOST_HOLD_MS) call([]);
      call([F(0)]); // the first call past T's hold: F0 back in place
      const back = t.views().find((v) => v.present)!;
      expect([back.person, back.edited, s.params(back.person)]).toEqual([ids[0], true, naturalPerson()]);
      expect(t.views()).toHaveLength(1); // T dropped, after her take
      expect(s.awayCandidates(tv.box, W / H, now).map((c) => c.id)).toEqual([tv.person]); // T away now
      for (let k = 1; k < 10; k++) expect(s.awayCandidates(at([F(k)]), W / H, now).map((c) => c.id)).toEqual([ids[k]]); // nobody evicted
    });
    it.each(paths)('%s: ten edited people back on the first call past the hold of ten edited tracks: all ten keep their persons', (_, scope) => {
      const s = new LivePersons();
      const t = new FaceTracks(s);
      let now = 0;
      const call = (lms: readonly Landmarks478[]) => {
        t.detect(lms, now, W, H, scope);
        t.step(33, now);
        now += 33;
      };
      // C21's two groups of ten, each face of one farther from every face of the other than §7.4's 1.5 widths
      const first = Array.from({ length: 10 }, (_, i) => lmAt(0.23 + (i % 5) * 0.18, i < 5 ? 0.5 : 0.9, 0.08));
      const second = Array.from({ length: 10 }, (_, i) => lmAt(0.14 + (i % 5) * 0.18, i < 5 ? 0.3 : 0.7, 0.08));
      for (let i = 0; i < 5; i++) call(first);
      const ones = first.map((f) => id(t, at([f])));
      s.write(ones, naturalPerson());
      for (let i = 0; i < 5; i++) call(second); // the first group away as the second comes (each evicted): the pool full
      const twos = t.views().map((v) => v.person);
      s.write(twos, personFromPreset('refined', 1));
      const last = now - 33;
      while (now - last <= LOST_HOLD_MS) call([]); // the second group held
      call(first); // the first call past the second group's hold
      expect(first.map((f) => id(t, at([f])))).toEqual(ones);
      expect(ones.every((p) => JSON.stringify(s.params(p)) === JSON.stringify(naturalPerson()))).toBe(true);
      expect(twos.every((p) => s.edited(p))).toBe(true); // the second group away now
    });
    it.each(paths)('%s: a pinned edited face back on the call its hold runs out, 0.8 widths off, keeps its person and the pin, never released', (_, scope) => {
      const s = new LivePersons();
      const t = new FaceTracks(s);
      let now = 0;
      const call = (lms: readonly Landmarks478[]) => {
        t.detect(lms, now, W, H, scope);
        t.step(33, now);
        now += 33;
      };
      for (let i = 0; i < 5; i++) call([A(), B()]);
      const b = t.views().find((v) => v.box.x > 0.5)!;
      s.pin(b.person);
      s.edit(naturalPerson());
      const last = now - 33;
      while (now - last <= LOST_HOLD_MS) call([A()]);
      call([A(), lmAt(0.7 - 0.8 * 0.2, 0.5, 0.2)]); // past the IoU and centre rules, inside §7.4's gates
      const v = t.views().find((x) => x.person === b.person)!;
      expect([v.present, v.edited, s.selection()]).toEqual([true, true, b.person]);
      expect(s.awayCandidates(b.box, W / H, now)).toEqual([]);
    });
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
  describe('round-2 review D1: a track past its hold is a re-identification candidate wherever its face comes back', () => {
    // two tiles called in turn every 100 ms: tL (x 0–0.55, the far faces' own view) and tR (x 0.45–1, G's); T away just
    // over the hold, back 0.6 widths left of his last place (past the IoU and centre rules, inside §7.4's gates) on
    // tL's first call after tR's, the first call after his hold ran out
    const tL = scope(0, 0.55);
    const tR = scope(0.45, 1);
    const G = () => lmAt(0.8, 0.5, 0.06);
    const runPair = (s: LivePersons, withQ: boolean) => {
      s.setPath('group', 0);
      const t = new FaceTracks(s);
      let pq = -1;
      let pt = -1;
      for (let i = 0, now = 0; i < 40; i++, now += 100) {
        const left: Landmarks478[] = [];
        if (withQ && i < 12) left.push(lmAt(0.12, 0.5, 0.06)); // Q, edited 自然, leaves first (away, in grace)
        if (i < 20) left.push(lmAt(0.22, 0.5, 0.06)); // T, edited 精緻
        if (i >= 30) left.push(lmAt(0.185, 0.5, 0.06)); // T back
        t.detect(i % 2 === 0 ? left : [G()], now, W, H, i % 2 === 0 ? tL : tR);
        t.step(33, now);
        if (i === 6) {
          const vs = t.views().filter((v) => v.box.x < 0.5).sort((a, b) => a.box.x - b.box.x);
          [pq, pt] = withQ ? vs.map((v) => v.person) : [-1, vs[0].person];
          if (withQ) s.write([pq], naturalPerson());
          s.write([pt], personFromPreset('refined', 1));
        }
      }
      return { t, pt };
    };
    it('with an edited away neighbour nearer than the gates, his face gets his own person, not hers', () => {
      const s = new LivePersons();
      const { t, pt } = runPair(s, true);
      const f = t.views().find((v) => v.box.x < 0.5)!;
      expect([f.person, s.params(f.person)]).toEqual([pt, personFromPreset('refined', 1)]);
    });
    it('alone, his face gets his own person back, not a new one at 原圖', () => {
      const s = new LivePersons();
      const { t, pt } = runPair(s, false);
      const f = t.views().find((v) => v.box.x < 0.5)!;
      expect([f.person, f.edited]).toEqual([pt, true]);
    });
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
  describe('C9: a no-answer on the group path drops or evicts no track before a call that can see it answers (A5)', () => {
    // three far faces, each found only by its own tile, and the whole view, which finds none of them and can miss none;
    // one call every 500 ms, so a tile comes back every 2 s
    const whole: DetectScope = { name: 'whole', view: { x: 0, y: 0, w: 1, h: 1 }, matchable: () => true, missable: () => false };
    const [s1, s2, s3] = [scope(0, 0.3), scope(0.35, 0.65), scope(0.7, 1)];
    const face = [() => lmAt(0.15, 0.5, 0.06), () => lmAt(0.5, 0.5, 0.06), () => lmAt(0.85, 0.5, 0.06)];
    const call = (t: FaceTracks, i: number, now: number) => {
      const k = i % 4;
      t.detect(k === 3 ? [] : [face[k]()], now, W, H, [s1, s2, s3, whole][k]);
      t.step(33, now);
    };
    it('a far face refreshed by its own tile keeps its track when the hiccup came just after its refresh', () => {
      const t = new FaceTracks(editedAll());
      let now = 0;
      for (let i = 0; i < 6; i++, now += 500) call(t, i, now); // the last: s2 refreshes B at 2500
      const ids = [...t.views()].sort((a, b) => a.box.x - b.box.x).map((v) => v.id);
      expect(ids).toHaveLength(3);
      t.detect(null, 2533, W, H); // one no-answer
      t.step(33, 2533);
      for (let i = 6, at = 2566; i < 14; i++, at += 500) {
        call(t, i, at);
        expect([...t.views()].sort((a, b) => a.box.x - b.box.x).map((v) => v.id)).toEqual(ids);
      }
      expect(t.views().every((v) => v.present)).toBe(true);
    });
    it('with every slot taken, a new face after a no-answer evicts no track the call cannot see', () => {
      const t = new FaceTracks(editedAll());
      const row = Array.from({ length: MAX_LIVE_FACES }, (_, i) => lmAt(0.05 + i * 0.1, 0.3, 0.04));
      t.detect(row, 0, W, H); // every face tracked by an unscoped call
      t.step(33, 0);
      const ids = t.views().map((v) => v.id).sort();
      t.detect(null, 33, W, H);
      t.step(33, 33);
      const v = { x: 0.1, y: 0.55, w: 0.1, h: 0.3 }; // a tile below the row: it holds none of the tracks
      const inside = (b: Rect) => b.x >= v.x && b.y >= v.y && b.x + b.w <= v.x + v.w && b.y + b.h <= v.y + v.h;
      t.detect([lmAt(0.15, 0.7, 0.04)], 66, W, H, { name: 'tile', view: v, matchable: inside, missable: inside }); // a face new to it
      t.step(33, 66);
      expect(t.views().map((v) => v.id).sort()).toEqual(ids);
    });
    it('round-4 review F3: a view’s no-answer leaves unseen only what that view could miss', () => {
      const t = new FaceTracks(editedAll());
      [s1, s2, s3].forEach((s, k) => t.detect([face[k]()], k * 33, W, H, s)); // each far face found by its own tile
      const state = () => [...t.views()].sort((a, b) => a.box.x - b.box.x).map((v) => [v.present, v.stale]);
      t.detect(null, 99, W, H, s2); // s2's call has no answer: the face it holds is unseen, the others stay found
      expect(state()).toEqual([[true, false], [false, true], [true, false]]);
      t.detect(null, 132, W, H, whole); // the whole view, which can miss none of them: no event
      expect(state()).toEqual([[true, false], [false, true], [true, false]]);
      // unscoped (the solo path's whole frame, which can miss every track): every track found is unseen, as before
      t.detect(null, 165, W, H);
      expect(state()).toEqual([[false, true], [false, true], [false, true]]);
      expect(t.views()).toHaveLength(3);
    });
    it('round-5 review G4: a view’s no-answer pauses the hold of only what that view could miss; unscoped, every hold', () => {
      // the far right face H leaves: missed by s3 at 66, held. Each 33 ms the whole view (which can miss none of the far
      // faces) has no answer, then s1 answers, then s3 (H's own tile) misses H again. H's hold runs on: it is dropped
      // one LOST_HOLD_MS after its last sighting, not stretched by the whole view's gaps (each was a pause for every track)
      const cycle = (t: FaceTracks, from: number, until: number, own: (now: number) => readonly Landmarks478[] | null) => {
        for (let i = 0, now = from; now <= until; i++, now += 33) {
          if (i % 3 === 0) t.detect(null, now, W, H, whole);
          else if (i % 3 === 1) t.detect([face[0]()], now, W, H, s1);
          else t.detect(own(now), now, W, H, s3);
          t.step(33, now);
        }
      };
      const left = () => {
        const t = new FaceTracks(editedAll());
        t.detect([face[0](), face[2]()], 0, W, H);
        t.detect([], 33, W, H, s3); // H's last sighting at 0, missed at 33: held
        expect([...t.views()].sort((a, b) => a.box.x - b.box.x).map((v) => v.present)).toEqual([true, false]);
        return t;
      };
      const t = left();
      cycle(t, 66, LOST_HOLD_MS - 40, () => []);
      expect(t.views()).toHaveLength(2); // still held
      cycle(t, LOST_HOLD_MS - 7, LOST_HOLD_MS + 160, () => []);
      expect(t.views()).toHaveLength(1); // dropped on time
      // H's own tile without an answer: H's hold is paused from that no-answer to the next answer (A5, E5)
      const u = left();
      for (let now = 66; now < 3000; now += 33) u.detect(null, now, W, H, s3); // s3 alone, never answering, for 3 s
      cycle(u, 3000, 3000 + 600, () => []);
      expect(u.views()).toHaveLength(2); // 66 ms of the hold ran before the first no-answer, and about 600 since the next answer
      // unscoped (the solo path's whole frame): every track's hold is paused, as before
      const v = left();
      for (let now = 66; now < 3000; now += 33) v.detect(null, now, W, H);
      v.detect([face[0]()], 3000, W, H, s1);
      expect(v.views()).toHaveLength(2);
    });
  });
  describe('the shutter’s views as one call (detectViews, §6.6 Capture; round-5 review G1, G2, Codex P2)', () => {
    const sL = scope(0, 0.5);
    const sR = scope(0.3, 1); // the two overlap over x 0.3–0.5
    const answers = (...list: [DetectScope, readonly Landmarks478[]][]) => list.map(([s, lms]) => ({ lms, scope: s }));
    /** the union of the views that answered (shutterScope's matching and missing) */
    const union = (...ss: DetectScope[]): DetectScope => ({
      name: 'shutter',
      view: { x: 0, y: 0, w: 1, h: 1 },
      matchable: (b) => ss.some((s) => s.matchable(b)),
      missable: (p) => ss.some((s) => s.missable(p)),
    });
    const state = (t: FaceTracks) => [...t.views()].sort((a, b) => a.box.x - b.box.x).map((v) => [v.present, v.stale, v.seen]);
    it('Codex P2: a face one view found is found though another view that holds it found no face there; one call per view marked it missing', () => {
      const a = () => lmAt(0.4, 0.5, 0.06); // in both views
      const e = () => lmAt(0.8, 0.5, 0.06); // sR's only
      const fresh = () => {
        const t = new FaceTracks(editedAll());
        t.detect([a(), e()], 0, W, H);
        return t;
      };
      const t = fresh();
      t.detectViews(answers([sL, [a()]], [sR, [e()]]), 33, W, H, union(sL, sR));
      expect(state(t)).toEqual([
        [true, false, 33],
        [true, false, 33],
      ]);
      // the loop's way, one call per view on the same pixels: sR, which found E only, missed A
      const u = fresh();
      u.detect([a()], 33, W, H, sL);
      u.detect([e()], 34, W, H, sR);
      expect(state(u).map((s) => s[0])).toEqual([false, true]);
    });
    it('a track is missed only when a view that answered could miss it and no view found it; a view with no answer is no event; no answer at all, nothing', () => {
      const t = new FaceTracks(editedAll());
      t.detect([lmAt(0.15, 0.5, 0.06), lmAt(0.85, 0.5, 0.06)], 0, W, H);
      // sL answered without its face; sR (the right face's only view) had no answer, so it is not among the answers
      t.detectViews(answers([sL, []]), 33, W, H, union(sL));
      expect(state(t)).toEqual([
        [false, false, 0],
        [true, false, 0],
      ]);
      t.detectViews([], 66, W, H, union());
      expect(state(t)).toEqual([
        [false, false, 0],
        [true, false, 0],
      ]);
    });
    it('a face two views found is one face: its track fed once, a new face one track; two faces each view found apart stay two', () => {
      const t = new FaceTracks(editedAll());
      t.detect([lmAt(0.35, 0.5, 0.06)], 0, W, H);
      // both views find A (a little apart, as two detectors do) and a new face N in their overlap
      t.detectViews(
        answers([sL, [lmAt(0.35, 0.5, 0.06), lmAt(0.45, 0.5, 0.05)]], [sR, [lmAt(0.351, 0.5, 0.059), lmAt(0.451, 0.5, 0.051)]]),
        33,
        W,
        H,
        union(sL, sR),
      );
      expect(state(t)).toEqual([
        [true, false, 33],
        [true, false, 33],
      ]);
      // P and Q, one partly behind the other (box IoU about 0.5, under the 0.6 that makes two finds of one view one face),
      // each view finding both: two tracks
      const u = new FaceTracks(editedAll());
      const pq = () => [lmAt(0.38, 0.5, 0.06), lmAt(0.4, 0.5, 0.06)];
      u.detectViews(answers([sL, pq()], [sR, pq()]), 0, W, H, union(sL, sR));
      expect(u.views()).toHaveLength(2);
    });
    it('a partial find of a face another view found whole (box IoU about 0.4) takes no second track', () => {
      const f = () => lmAt(0.45, 0.5, 0.08); // sL's find, x 0.41–0.49
      // sR's: part of the same face, inside sR (x 0.442–0.49): one head's mesh, its outline drawn in to the part it fits
      // (× 0.6 toward its right edge, × 0.7 in height), its eyes, nose and mouth where sL's are (round-6 review H2: a
      // smaller face's own mesh, its marks elsewhere, is someone else)
      const part = () => outlineIn(f(), 0.6, 0.7);
      expect(boxIoU(ovalBox(adapt(f(), W, H)), ovalBox(adapt(part(), W, H)))).toBeCloseTo(0.42, 2);
      const t = new FaceTracks(editedAll());
      t.detect([f()], 0, W, H);
      const id = t.views()[0].id;
      t.detectViews(answers([sL, [f()]], [sR, [part()]]), 33, W, H, union(sL, sR));
      expect(t.views().map((v) => [v.id, v.present, v.seen])).toEqual([[id, true, 33]]);
      expect(boxIoU(t.views()[0].rawBox, ovalBox(adapt(f(), W, H)))).toBeCloseTo(1, 6);
      // the same finds as one view's (two faces to that view's detector): a second track
      const u = new FaceTracks(editedAll());
      u.detect([f()], 0, W, H);
      u.detect([f(), part()], 33, W, H, sR);
      expect(u.views()).toHaveLength(2);
    });
    it('everyone is re-identified once, over every view’s faces: an edited person back, found by two views, is one track with their person', () => {
      const s = new LivePersons();
      s.setPath('group', 0);
      const t = new FaceTracks(s);
      const p = () => lmAt(0.4, 0.5, 0.06);
      t.detect([p()], 0, W, H, union(sL, sR));
      const id = t.views()[0].person;
      s.write([id], naturalPerson());
      for (let now = 33; now <= LOST_HOLD_MS + 100; now += 33) t.detect([], now, W, H, sL);
      expect(t.views()).toHaveLength(0); // dropped past the hold: away, edited, in grace
      t.detectViews(answers([sL, [p()]], [sR, [lmAt(0.401, 0.5, 0.059)]]), LOST_HOLD_MS + 300, W, H, union(sL, sR));
      expect(t.views().map((v) => [v.person, v.edited])).toEqual([[id, true]]);
    });
    it('round-6 review H2: two finds that match two different tracks are two faces, even where their meshes put the eyes, nose and mouth at one place: each track fed', () => {
      const p = () => lmAt(0.38, 0.5, 0.06);
      const q = () => lmAt(0.4, 0.5, 0.06); // box IoU about 0.5 with P's
      const t = new FaceTracks(editedAll());
      t.detect([p(), q()], 0, W, H);
      // sR's find: Q's outline (so its box is Q's) on P's inner marks, which sameHead alone takes for P's head
      const mixed = (): Landmarks478 => {
        const m = p().points.slice();
        const o = q().points;
        for (const i of FACE_OVAL) m.set(o.subarray(i * 3, i * 3 + 3), i * 3);
        return { points: m };
      };
      expect(sameHead({ box: ovalBox(adapt(p(), W, H)), lm: p().points }, { box: ovalBox(adapt(mixed(), W, H)), lm: mixed().points }, W, H)).toBe(true);
      t.detectViews(answers([sL, [p()]], [sR, [mixed()]]), 33, W, H, union(sL, sR));
      expect(state(t)).toEqual([
        [true, false, 33],
        [true, false, 33],
      ]);
    });
  });
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

  describe('a face at an internal tile edge or the crop edge (round-1 review C5, C6)', () => {
    // the upright 1080 × 1920 stream, 3:4 crop (y 240–1680 px), the back camera's views: tiles t0,0 (x 0–720 px) and
    // t1,0 (x 360–1080 px) overlap, row 0 (y 240–960 px)
    const FW = 1080;
    const FH = 1920;
    const crop = { x: 0, y: 240, w: 1080, h: 1440 };
    const l = layoutViews(FW, FH, crop, 'environment', 'photo');
    const scopeOf = (id: string) => viewScope(id === 'whole' ? l.whole : l.tiles.find((v) => v.id === id)!, l);
    const [whole, t00, t10] = ['whole', 't0,0', 't1,0'].map(scopeOf);
    const calib = ovalBox(adapt(lmAt(0.5, 0.5, 0.1), FW, FH));
    /** a face whose oval box spans x0 … x0 + w px, centred at v (UV) */
    const at = (x0: number, w: number, v = 0.3): Landmarks478 => {
      const s = w / FW / calib.w;
      const ocx = 0.5 + (calib.x + calib.w / 2 - 0.5) * s;
      return lmAt(0.5 + (x0 + w / 2) / FW - ocx, v, 0.1 * s);
    };
    const px = (b: Rect) => [Math.round(b.x * FW), Math.round((b.x + b.w) * FW)];
    const call = (t: FaceTracks, lms: Landmarks478[], now: number, scope: DetectScope) => {
      t.detect(lms, now, FW, FH, scope);
      t.step(33, now);
    };
    it('the helper places the boxes where the tests say', () => {
      expect(px(ovalBox(adapt(at(641, 80), FW, FH)))).toEqual([641, 721]);
      expect(px(ovalBox(adapt(at(639, 80), FW, FH)))).toEqual([639, 719]);
    });
    it('C5: a face its tile holds whole feeds the track predicted across that tile’s edge, never a second person on it', () => {
      const s = new LivePersons();
      const t = new FaceTracks(s);
      let now = 0;
      for (let i = 0; i < 5; i++, now += 33) call(t, [at(641, 80)], now, t10); // x 641–721: t1,0's, across t0,0's edge
      const p = t.views()[0].person;
      call(t, [at(639, 80)], now, t00); // the scan of t0,0 sees it 2 px left, inside t0,0
      expect(t.views().map((v) => [v.person, v.view, v.present])).toEqual([[p, 't0,0', true]]);
    });
    it('C5: a neighbour’s face beside a missed track, seen by a tile that cannot see the neighbour, is left to the neighbour’s own view, which gives it to the neighbour (A2, §7.1 I3)', () => {
      const s = new LivePersons();
      const t = new FaceTracks(s);
      let now = 0;
      for (let i = 0; i < 5; i++, now += 33) call(t, [at(544, 80), at(641, 80)], now, whole);
      const [a, b] = [...t.views()].sort((x, y) => x.box.x - y.box.x).map((v) => v.person);
      s.pin(a);
      s.edit(naturalPerson());
      // A blinks; B, whose box crosses t0,0's edge, is seen inside t0,0: B's face or A's? t0,0 cannot see B's place
      call(t, [at(639, 80)], now, t00);
      now += 33;
      const rows = () => [...t.views()].sort((x, y) => x.person - y.person).map((v) => [v.person, v.present, v.view, px(v.rawBox)]);
      expect(rows()).toEqual([
        [a, true, 'whole', [544, 624]],
        [b, true, 'whole', [641, 721]],
      ]);
      call(t, [at(639, 80)], now, t10); // B's own view sees both places
      expect(rows()).toEqual([
        [a, false, 'whole', [544, 624]],
        [b, true, 't1,0', [639, 719]],
      ]);
    });
    it('C5: a face cut by the tile’s edge, nearest a track the tile cannot match, continues no missed track beside it (A2)', () => {
      const s = new LivePersons();
      const t = new FaceTracks(s);
      let now = 0;
      for (let i = 0; i < 5; i++, now += 33) call(t, [at(544, 80), at(641, 80)], now, whole);
      const [a, b] = [...t.views()].sort((x, y) => x.box.x - y.box.x).map((v) => v.person);
      s.pin(a);
      s.edit(naturalPerson());
      call(t, [at(645, 80)], now, t00); // A blinks; B's face crosses t0,0's edge (x 645–725): the tile sees it cut
      const byPerson = new Map(t.views().map((v) => [v.person, v]));
      expect(t.views()).toHaveLength(2);
      expect([byPerson.get(a)!.present, px(byPerson.get(a)!.box)]).toEqual([false, [544, 624]]);
      expect([byPerson.get(b)!.view, px(byPerson.get(b)!.box)]).toEqual(['whole', [641, 721]]);
    });
    it('C5: a held track predicted across the tile’s edge is continued by its face that tile holds whole', () => {
      const s = new LivePersons();
      const t = new FaceTracks(s);
      let now = 0;
      for (let i = 0; i < 5; i++, now += 33) call(t, [at(641, 80)], now, t10);
      const b = t.views()[0].person;
      s.pin(b);
      s.edit(naturalPerson());
      for (let i = 0; i < 2; i++, now += 33) call(t, [], now, t10); // its own tile misses it: held
      call(t, [at(590, 80)], now, t00); // back 0.64 widths left (past the IoU and centre rules), inside t0,0
      expect(t.views().map((v) => [v.person, v.present, v.view, px(v.rawBox)])).toEqual([[b, true, 't0,0', [590, 670]]]);
    });
    /** an edited, pinned B at x 641–721, refreshed by t1,0 (its own view), across t0,0's edge */
    const pinnedB = () => {
      const s = new LivePersons();
      const t = new FaceTracks(s);
      for (let i = 0; i < 5; i++) call(t, [at(641, 80)], i * 33, t10);
      const b = t.views()[0].person;
      s.pin(b);
      s.edit(naturalPerson());
      return { s, t, b, now: 5 * 33 };
    };
    const rowsOf = (t: FaceTracks) => [...t.views()].sort((x, y) => x.box.x - y.box.x).map((v) => [v.person, v.edited, v.present, v.view, px(v.rawBox)]);
    it('round-2 review D5: a track found elsewhere whose face moves a width into the tile is left to its own view, which continues it: one track, its person (no second person on its face)', () => {
      const { t, b, now } = pinnedB();
      call(t, [at(561, 80)], now, t00); // B moved 80 px left between refreshes; t0,0 holds the face whole, not B's place
      expect(rowsOf(t)).toEqual([[b, true, true, 't1,0', [641, 721]]]);
      let at2 = now + 33;
      call(t, [at(561, 80)], at2, t10);
      expect(rowsOf(t)).toEqual([[b, true, true, 't1,0', [561, 641]]]);
      // 1.3 s more of t1,0's calls, t0,0 every 4th (a scan): still one track, B's
      for (let i = 0; i < 40; i++) call(t, [at(561, 80)], (at2 += 33), i % 4 === 3 ? t00 : t10);
      expect(rowsOf(t).map((r) => r.slice(0, 3))).toEqual([[b, true, true]]);
    });
    it('C5: a new face beside a track found elsewhere is left to that track’s own view, which starts it at 原圖 while the track keeps its face', () => {
      const { t, b, now } = pinnedB();
      call(t, [at(560, 80)], now, t00); // someone new 1 width left of B (within the re-identification distance)
      expect(rowsOf(t)).toEqual([[b, true, true, 't1,0', [641, 721]]]);
      call(t, [at(560, 80), at(641, 80)], now + 33, t10); // B's own view sees B in place and the newcomer
      const rows = rowsOf(t);
      expect(rows[1]).toEqual([b, true, true, 't1,0', [641, 721]]);
      expect([rows[0][1], rows[0][2], rows[0][4]]).toEqual([false, true, [560, 640]]);
    });
    it('round-6 review Codex #1: a pair’s face left to its track’s own view leaves that track a candidate of the call’s other faces: a smaller face about as near it as the edited neighbour takes neither person', () => {
      const s = new LivePersons();
      const t = new FaceTracks(s);
      let now = 0;
      for (let i = 0; i < 5; i++, now += 33) call(t, [at(350, 160), at(561, 160)], now, whole); // A, B: large, the whole view's
      const [a, b] = [...t.views()].sort((x, y) => x.box.x - y.box.x).map((v) => v.person);
      s.pin(a);
      s.edit(naturalPerson());
      // t0,0 finds B 2 px left (inside t0,0, B's place across its edge: left to the whole view, A a candidate too) and a
      // smaller face between A and B, inside the re-identification gates of both and about as near each (A2: nobody's)
      call(t, [at(559, 160), at(470, 110)], now, t00);
      const rows = rowsOf(t);
      expect([rows[0], rows[2]]).toEqual([
        [a, true, true, 'whole', [350, 510]],
        [b, false, true, 'whole', [561, 721]],
      ]);
      expect([a, b]).not.toContain(rows[1][0]);
      expect(rows[1].slice(1)).toEqual([false, true, 't0,0', [470, 580]]);
    });
    it('round-6 review Codex #2, H2: two people one partly behind the other (box IoU about 0.45), each found at the shutter by one view only, are two faces: both fed, the edited one found', () => {
      const s = new LivePersons();
      const t = new FaceTracks(s);
      let now = 0;
      for (let i = 0; i < 5; i++, now += 33) call(t, [at(450, 160), at(510, 160)], now, whole); // P, Q: large
      const [p, q] = [...t.views()].sort((x, y) => x.box.x - y.box.x).map((v) => v.person);
      s.pin(q);
      s.edit(naturalPerson());
      expect(boxIoU(ovalBox(adapt(at(450, 160), FW, FH)), ovalBox(adapt(at(510, 160), FW, FH)))).toBeCloseTo(0.45, 1);
      // the shutter's cycle: the whole view finds P only, t0,0 Q only (each detector missed the other face)
      const shutter = (u: FaceTracks, ms: number) =>
        u.detectViews([{ lms: [at(450, 160)], scope: whole }, { lms: [at(510, 160)], scope: t00 }], ms, FW, FH, shutterScope([l.whole, l.tiles[0]], l));
      shutter(t, now);
      expect(rowsOf(t)).toEqual([
        [p, false, true, 'whole', [450, 610]],
        [q, true, true, 't0,0', [510, 670]],
      ]);
      // two newcomers there, each found by one view only: two tracks (no track tells them apart; their meshes do)
      const u = new FaceTracks(new LivePersons());
      shutter(u, 0);
      expect(rowsOf(u).map((r) => r.slice(3))).toEqual([
        ['whole', [450, 610]],
        ['t0,0', [510, 670]],
      ]);
    });
    describe('round-3 review E1: a face left to a view is one event, ended by its answer', () => {
      it.each([600, 1500, 3000])('D5 twice: B moves a width into t0,0 again %i ms after the first time, and is left to t1,0 again: one track, B’s', (gap) => {
        const { t, b, now: t0 } = pinnedB();
        let now = t0;
        const sway = () => {
          call(t, [at(561, 80)], now, t00); // t0,0 sees the move first: left to t1,0
          now += 33;
          for (let i = 0; i < 6; i++, now += 33) call(t, [at(561, 80)], now, t10); // which continues B
          expect(rowsOf(t)).toEqual([[b, true, true, 't1,0', [561, 641]]]);
        };
        sway();
        // back on the edge: t1,0 refreshes it, t0,0 (every 4th) sees it cut
        for (let i = 0; now < t0 + gap; i++, now += 33) call(t, [at(641, 80)], now, i % 4 === 3 ? t00 : t10);
        call(t, [at(561, 80)], now, t00);
        expect(rowsOf(t)).toEqual([[b, true, true, 't1,0', [641, 721]]]); // left again, no second person on B's face
        now += 33;
        for (let i = 0; i < 6; i++, now += 33) call(t, [at(561, 80)], now, t10);
        expect(rowsOf(t)).toEqual([[b, true, true, 't1,0', [561, 641]]]);
        for (let i = 0; i < 40; i++, now += 33) call(t, [at(561, 80)], now, i % 4 === 3 ? t00 : t10);
        expect(rowsOf(t).map((r) => r.slice(0, 3))).toEqual([[b, true, true]]);
      });
      it('B back on its edge before t1,0 answers: the answer finds B in place, t0,0’s next call (no face there) ends the entry, and B’s next move is left again', () => {
        const { t, b, now: t0 } = pinnedB();
        let now = t0;
        call(t, [at(561, 80)], now, t00); // left
        call(t, [at(641, 80)], (now += 33), t10); // B is back: t1,0 refreshes it in place, the face left is not there
        call(t, [at(641, 80)], (now += 33), t00); // t0,0 sees B cut by its edge, nothing where the face was
        call(t, [at(641, 80)], (now += 33), t10);
        call(t, [at(561, 80)], (now += 33), t00); // B moves again: a new event, left to t1,0
        expect(rowsOf(t)).toEqual([[b, true, true, 't1,0', [641, 721]]]);
        call(t, [at(561, 80)], (now += 33), t10);
        expect(rowsOf(t)).toEqual([[b, true, true, 't1,0', [561, 641]]]);
      });
      describe('round-4 review F4: the solo path and a layout change end every entry (E1 (d)): a face left before them is a new event after', () => {
        // B's move is left to t1,0; B is then refreshed in place by the solo path's call (合照模式 toggled off and on) or
        // by t1,0 under a new layout (3:4 → 9:16), so the entry's wait reads answered. B moves into t0,0 again on the
        // group path: without the end, t0,0 placed the face at once, a new person at 原圖 on B's face, B then missed
        const l916 = layoutViews(FW, FH, { x: 0, y: 0, w: FW, h: FH }, 'environment', 'photo');
        const [t00b, t10b] = ['t0,0', 't1,0'].map((id) => viewScope(l916.tiles.find((v) => v.id === id)!, l916));
        it('the layouts differ where the tests say: t0,0’s and t1,0’s rects move, B (641–721) is t1,0’s and across t0,0’s edge in both', () => {
          expect([t00b.view, t10b.view]).not.toEqual([t00.view, t10.view]);
          const bb = ovalBox(adapt(at(641, 80), FW, FH));
          const moved = ovalBox(adapt(at(561, 80), FW, FH));
          for (const [a0, a1] of [[t00, t10], [t00b, t10b]]) expect([a0.matchable(bb), a1.matchable(bb), a0.matchable(moved), a1.matchable(moved)]).toEqual([false, true, true, true]);
        });
        it.each([
          ['the solo path’s call', 'solo'],
          ['t1,0 called with a new rect (a ratio change)', 'layout'],
        ] as const)('B refreshed in place by %s: B’s next move into t0,0 is left to t1,0 again, which continues B (one track, B’s)', (_, by) => {
          const { t, b, now: t0 } = pinnedB();
          let now = t0;
          call(t, [at(561, 80)], now, t00); // left to t1,0
          expect(rowsOf(t)).toEqual([[b, true, true, 't1,0', [641, 721]]]);
          now += 33;
          if (by === 'solo') {
            t.detect([at(641, 80)], now, FW, FH); // 合照模式 off: the VIDEO call refreshes B in place
            t.step(33, now);
          } else call(t, [at(641, 80)], now, t10b);
          const [own, other] = by === 'solo' ? [t10, t00] : [t10b, t00b];
          expect(rowsOf(t)).toEqual([[b, true, true, by === 'solo' ? 'video' : 't1,0', [641, 721]]]);
          call(t, [at(561, 80)], (now += 33), other); // back on the group path / the new layout: B moves again
          expect(rowsOf(t)).toEqual([[b, true, true, by === 'solo' ? 'video' : 't1,0', [641, 721]]]); // left, not placed
          call(t, [at(561, 80)], (now += 33), own);
          expect(rowsOf(t)).toEqual([[b, true, true, 't1,0', [561, 641]]]);
        });
      });
      it('no swap: A (edited, pinned) inside both tiles blinks on t0,0’s call as B (never edited) moves into t0,0 a second time; each keeps their own face', () => {
        const s = new LivePersons();
        const t = new FaceTracks(s);
        let now = 0;
        for (let i = 0; i < 5; i++, now += 33) call(t, [at(470, 80), at(641, 80)], now, i % 2 ? t00 : t10);
        const [a, b] = rowsOf(t).map((r) => r[0] as number);
        s.pin(a);
        s.edit(naturalPerson());
        call(t, [at(470, 80), at(561, 80)], now, t00); // B's first move: left to t1,0
        now += 33;
        for (let i = 0; i < 6; i++, now += 33) call(t, [at(470, 80), at(561, 80)], now, t10);
        for (let i = 0; i < 12; i++, now += 33) call(t, [at(470, 80), at(641, 80)], now, i % 2 ? t00 : t10);
        call(t, [at(561, 80)], now, t00); // B's second move; A's face not found on this call
        now += 33;
        for (let i = 0; i < 30; i++, now += 33) call(t, [at(470, 80), at(561, 80)], now, i % 2 ? t00 : t10);
        const owner = (x: number) => rowsOf(t).find((r) => (r[4] as number[])[0] === x)?.[0];
        expect([owner(470), owner(561), t.views().length]).toEqual([a, b, 2]);
        expect([s.edited(a), s.edited(b)]).toEqual([true, false]);
      });
      it('no swap when the call cannot tell: B (never edited) moves into t0,0 on its calls and back on t1,0’s, A blinks on one of t0,0’s; A’s person is never on another face (A2)', () => {
        const s = new LivePersons();
        const t = new FaceTracks(s);
        let now = 0;
        for (let i = 0; i < 5; i++, now += 33) call(t, [at(470, 80), at(641, 80)], now, i % 2 ? t00 : t10);
        const [a] = rowsOf(t).map((r) => r[0] as number);
        s.pin(a);
        s.edit(naturalPerson());
        for (let i = 0; i < 12; i++, now += 33) {
          if (i % 2 === 1) call(t, [at(470, 80), at(641, 80)], now, t10); // B back in place for t1,0
          else call(t, i === 2 ? [at(561, 80)] : [at(470, 80), at(561, 80)], now, t00); // B into t0,0; A blinks once
          const onA = t.views().find((v) => v.person === a);
          expect(onA && px(onA.rawBox)[0]).toBe(470);
        }
        for (let i = 0; i < 20; i++, now += 33) call(t, [at(470, 80), at(641, 80)], now, i % 2 ? t00 : t10);
        expect(rowsOf(t).find((r) => (r[4] as number[])[0] === 470)![0]).toBe(a);
        expect(s.edited(a)).toBe(true);
      });
    });
    describe('round-3 review E2: a face left takes nobody out of another face’s candidates', () => {
      // P (edited 自然, at 530–610) beside B (641–721, across t0,0's edge, own view t1,0), and with Q (精緻, 430–510): P
      // and Q step out and come back within the grace; P's face is back on a t0,0 call in which B's face is whole inside
      // t0,0 (2 px of jitter: B's pair is left, P is one of its candidates), or cut by t0,0's edge
      it.each([
        [false, true],
        [false, false],
        [true, true],
        [true, false],
      ] as const)('with Q in range %s, B’s face whole in t0,0 %s: P’s face gets P', (withQ, jitter) => {
        const s = new LivePersons();
        s.setPath('group', 0);
        const t = new FaceTracks(s);
        let now = 0;
        const first = withQ ? [at(430, 80), at(530, 80), at(641, 80)] : [at(530, 80), at(641, 80)];
        for (let i = 0; i < 5; i++, now += 33) call(t, first, now, whole);
        const ids = rowsOf(t).map((r) => r[0] as number);
        const [q, p] = withQ ? ids : [-1, ids[0]];
        s.write([p], naturalPerson());
        if (withQ) s.write([q], personFromPreset('refined', 1));
        for (let i = 0; i < 45; i++, now += 33) call(t, [at(641, 80)], now, [t00, t10, whole][i % 3]); // P (and Q) away
        expect(s.awayCandidates(ovalBox(adapt(at(530, 80), FW, FH)), FW / FH, now).map((c) => c.id)).toContain(p);
        call(t, [at(530, 80), jitter ? at(639, 80) : at(641, 80)], now, t00);
        now += 33;
        for (let i = 0; i < 30; i++, now += 33) call(t, [at(530, 80), at(641, 80)], now, [t10, whole, t00][i % 3]);
        const onP = rowsOf(t).find((r) => (r[4] as number[])[0] === 530)!;
        expect([onP[0], onP[1], s.params(p)]).toEqual([p, true, naturalPerson()]);
      });
      it('a face whose decision turns on a candidate of a face left waits for the same answer: the outcome is the one of the view that sees them all (I3)', () => {
        // B (精緻, 641–721, own view t1,0) stays; X (自然) steps out of 471–551 and comes back 90 px right (561–641: 80 px
        // from B, a tie for t0,0, which cannot see B, so it leaves her face), while a newcomer N (60 px) stands where X
        // was; t0,0's call misses B's face, which its edge cuts. Whether t0,0 or t1,0 answers first on that frame, X's
        // face gets X and N is someone new
        const outcome = (t0First: boolean) => {
          const s = new LivePersons();
          s.setPath('group', 0);
          const t = new FaceTracks(s);
          let now = 0;
          for (let i = 0; i < 5; i++, now += 33) call(t, [at(471, 80), at(641, 80)], now, whole);
          const [x, b] = rowsOf(t).map((r) => r[0] as number);
          s.write([x], naturalPerson());
          s.write([b], personFromPreset('refined', 1));
          for (let i = 0; i < 45; i++, now += 33) call(t, [at(641, 80)], now, [t10, whole][i % 2]); // X away
          if (t0First) call(t, [at(561, 80), at(470, 60)], (now += 33), t00);
          call(t, [at(561, 80), at(470, 60), at(641, 80)], (now += 33), t10);
          const owner = (x0: number) => rowsOf(t).find((r) => (r[4] as number[])[0] === x0)![0] as number;
          return [owner(561) === x, owner(641) === b, s.edited(owner(470)), t.views().length];
        };
        expect(outcome(false)).toEqual([true, true, false, 3]);
        expect(outcome(true)).toEqual(outcome(false));
      });
    });
    it('round-3 review E6: a held track whose face this call accounts for (cut by the view’s edge) is not evicted for a newcomer; its own view then continues it', () => {
      const s = new LivePersons();
      s.setPath('group', 0);
      const t = new FaceTracks(s, { maxFaces: 2 }); // the cap, at two
      const t02 = scopeOf('t0,2');
      let now = 0;
      for (let i = 0; i < 5; i++, now += 33) {
        call(t, [at(641, 80)], now, t10); // T, its own view t1,0
        call(t, [at(100, 80, 0.6)], now, t02); // O, far below
      }
      const tv = t.views().find((v) => v.view === 't1,0')!;
      s.write([tv.person], naturalPerson());
      call(t, [], now, t10); // T's own view misses T: held
      now += 33;
      call(t, [at(645, 80), at(100, 80)], now, t00); // T's face back, cut by t0,0's edge (accounted), and a newcomer N
      expect(t.views().find((v) => v.id === tv.id)).toMatchObject({ person: tv.person, edited: true });
      now += 33;
      call(t, [at(645, 80), at(100, 80)], now, t10);
      expect(t.views().find((v) => v.id === tv.id)).toMatchObject({ person: tv.person, edited: true, present: true });
      expect(px(t.views().find((v) => v.id === tv.id)!.rawBox)).toEqual([645, 725]);
    });
    describe('round-4 review F1, Codex P1: a held track decided for a face the view cannot feed is reserved, not left free (I1, I4)', () => {
      // T (edited 自然, pinned) with its own view t1,0, across t0,0's right edge (720 px). t1,0 misses T once (held); on
      // t0,0's next call T's face is back 50 px off its place, past the IoU and centre rules, inside §7.4's gates, and cut
      // by t0,0's edge: the decision gives it to T, whom t0,0 cannot feed. T is accounted for there: no other face of the
      // call continues T, and no newcomer evicts T; T's own view then continues T on that face
      it.each([
        ['Codex: T at 700–780, back at 650–730, a newcomer at 600–660', 700, 650, 600],
        ['F1: T at 641–721, back at 690–770, a newcomer at 560–620', 641, 690, 560],
      ] as const)('a newcomer beside it in the same call is someone new at 原圖, and T keeps T’s own face (%s)', (_, x0, back, x1) => {
        const s = new LivePersons();
        s.setPath('group', 0);
        const t = new FaceTracks(s);
        let now = 0;
        for (let i = 0; i < 5; i++, now += 33) call(t, [at(x0, 80)], now, t10);
        const T = t.views()[0].person;
        s.pin(T);
        s.edit(naturalPerson());
        call(t, [], now, t10); // T's own view misses T: held
        now += 33;
        call(t, [at(back, 80), at(x1, 60)], now, t00);
        const [n, onT] = rowsOf(t);
        expect(onT).toEqual([T, true, false, 't1,0', [x0, x0 + 80]]); // T accounted for, not fed (t0,0 cannot)
        expect(n.slice(1)).toEqual([false, true, 't0,0', [x1, x1 + 60]]); // the newcomer: someone new, at 原圖
        now += 33;
        call(t, [at(back, 80), at(x1, 60)], now, t10);
        expect(rowsOf(t)).toEqual([
          [n[0], false, true, 't1,0', [x1, x1 + 60]],
          [T, true, true, 't1,0', [back, back + 80]],
        ]);
        expect([s.edited(T), s.selection()]).toEqual([true, T]);
      });
      it('at the cap, a newcomer in the same call does not evict it: back at 690–770 (49 px off), T’s own view continues it (round-3 review E6’s residual)', () => {
        const s = new LivePersons();
        s.setPath('group', 0);
        const t = new FaceTracks(s, { maxFaces: 2 }); // the cap, at two
        const t02 = scopeOf('t0,2');
        let now = 0;
        for (let i = 0; i < 5; i++, now += 33) {
          call(t, [at(641, 80)], now, t10); // T, its own view t1,0
          call(t, [at(100, 80, 0.6)], now, t02); // O, far below
        }
        const tv = t.views().find((v) => v.view === 't1,0')!;
        s.write([tv.person], naturalPerson());
        call(t, [], now, t10); // T's own view misses T: held
        now += 33;
        call(t, [at(690, 80), at(100, 80)], now, t00); // T's face back past the IoU and centre rules, cut by t0,0's edge; a newcomer N
        expect(t.views().find((v) => v.id === tv.id)).toMatchObject({ person: tv.person, edited: true, present: false });
        now += 33;
        call(t, [at(690, 80), at(100, 80)], now, t10);
        expect(t.views().find((v) => v.id === tv.id)).toMatchObject({ person: tv.person, edited: true, present: true });
        expect(px(t.views().find((v) => v.id === tv.id)!.rawBox)).toEqual([690, 770]);
      });
      // the same hole for an away person (F1's root cause: a decision the view cannot act on left its owner in the set):
      // T missed past the hold, away (edited, pinned, in grace), or past it on this very call (`pending`); the decision
      // gives T's face, which t0,0's edge cuts, to T, whom t0,0 cannot start. T is claimed there: the newcomer is
      // someone new at 原圖, and T's own view starts T's face with T
      it.each([
        ['away since an earlier call', 'away', 641, 690, 560],
        ['away since an earlier call', 'away', 700, 650, 600],
        ['past the hold on this very call', 'pending', 641, 690, 560],
        ['past the hold on this very call', 'pending', 700, 650, 600],
      ] as const)('an away person decided for a face the view cannot start is claimed: T %s (%s), at %i, back at %i, a newcomer at %i', (_, gone, x0, back, x1) => {
        const s = new LivePersons();
        s.setPath('group', 0);
        const t = new FaceTracks(s);
        let now = 0;
        for (let i = 0; i < 5; i++, now += 33) call(t, [at(x0, 80)], now, t10);
        const T = t.views()[0].person;
        s.pin(T);
        s.edit(naturalPerson());
        if (gone === 'away') {
          // T's own view misses T past the hold: dropped, T away
          for (const end = now + LOST_HOLD_MS + 200; now < end; now += 33) call(t, [], now, t10);
          expect(t.views()).toHaveLength(0);
        } else {
          call(t, [], now, t10); // held, then no call until past the hold
          now += LOST_HOLD_MS + 200;
          expect(t.views().map((v) => [v.person, v.present])).toEqual([[T, false]]);
        }
        call(t, [at(back, 80), at(x1, 60)], now, t00);
        const [n] = rowsOf(t);
        expect(rowsOf(t)).toEqual([[n[0], false, true, 't0,0', [x1, x1 + 60]]]); // the newcomer: someone new, at 原圖
        expect(n[0]).not.toBe(T);
        now += 33;
        call(t, [at(back, 80), at(x1, 60)], now, t10);
        expect(rowsOf(t)).toEqual([
          [n[0], false, true, 't1,0', [x1, x1 + 60]],
          [T, true, true, 't1,0', [back, back + 80]],
        ]);
        expect([s.edited(T), s.selection()]).toEqual([true, T]);
      });
    });
    it('a face left to a view is left only until that view answers: one it cannot find is then started where it was seen (no face waits forever)', () => {
      const { t, b, now } = pinnedB();
      call(t, [at(560, 80)], now, t00);
      expect(t.views()).toHaveLength(1);
      call(t, [at(641, 80)], now + 33, t10); // B's own view finds B in place, and not the newcomer
      call(t, [at(560, 80)], now + 66, t00); // B is where t1,0 found it: the face is someone new
      const rows = rowsOf(t);
      expect(rows[1]).toEqual([b, true, true, 't1,0', [641, 721]]);
      expect([rows[0][1], rows[0][2], rows[0][3], rows[0][4]]).toEqual([false, true, 't0,0', [560, 640]]);
    });
    describe('round-2 review D2: an edited face moving toward a neighbour on a tile’s edge keeps its own person', () => {
      // A (edited, pinned) at x 544–624, inside t0,0; B at 641–721, across t0,0's edge; both found by the whole view.
      // Between refreshes A moves 0.55 or 0.95 widths toward B; t0,0 sees A's face whole, and B's cut by its edge or not
      // at all; then B's own view (t1,0) sees both in their places
      it.each([
        [0.55, true],
        [0.55, false],
        [0.95, true],
        [0.95, false],
      ] as const)('A moves %f widths, B’s cut face in t0,0’s call: %s', (move, withB) => {
        const s = new LivePersons();
        const t = new FaceTracks(s);
        let now = 0;
        for (let i = 0; i < 5; i++, now += 33) call(t, [at(544, 80), at(641, 80)], now, whole);
        const [a, b] = [...t.views()].sort((x, y) => x.box.x - y.box.x).map((v) => v.person);
        s.pin(a);
        s.edit(naturalPerson());
        const ax = 544 + Math.round(move * 80);
        call(t, withB ? [at(ax, 80), at(641, 80)] : [at(ax, 80)], now, t00);
        const owner = (x: number) => t.views().find((v) => Math.abs(px(v.rawBox)[0] - x) <= 1)?.person;
        // never a swap, never a second person: B keeps B's box, A is on A's moved face or still where it was
        expect(t.views()).toHaveLength(2);
        expect(owner(641)).toBe(b);
        expect([ax, 544]).toContain(px(t.views().find((v) => v.person === a)!.rawBox)[0]);
        call(t, [at(ax, 80), at(641, 80)], now + 33, t10);
        expect(t.views()).toHaveLength(2);
        expect([owner(ax), owner(641)]).toEqual([a, b]);
        expect([s.edited(a), s.edited(b)]).toEqual([true, false]);
      });
    });
    it('C6, round-2 review D9: a face the crop’s edge cuts starts a track in the view at that edge, the whole view (a close-up selfie on 3:4) or its edge tile (a far face only a tile finds), which keeps it; a face a tile’s edge cuts inside the crop starts none there', () => {
      const lu = layoutViews(FW, FH, crop, 'user', 'camera');
      const close = lmAt(0.5, 0.36, 0.75);
      expect(ovalBox(adapt(close, FW, FH)).y * FH).toBeLessThan(crop.y); // its forehead is above the crop
      const t = new FaceTracks(editedAll());
      for (let i = 0, now = 0; i < 30; i++, now += 33) call(t, [close], now, viewScope(lu.whole, lu));
      expect(t.views().map((v) => [v.present, v.view])).toEqual([[true, 'whole']]);
      // a far face (80 px, under the whole view's floor) across the crop's top edge: only t0,0, the tile at that edge,
      // finds it; it starts there, and the whole view, which cannot find it, never misses it (2 s, the calls alternating)
      const edge = at(100, 80, crop.y / FH);
      expect(ovalBox(adapt(edge, FW, FH)).y * FH).toBeLessThan(crop.y);
      const small = new FaceTracks(editedAll());
      for (let i = 0, now = 0; i < 60; i++, now += 33) call(small, i % 2 ? [] : [edge], now, i % 2 ? whole : t00);
      expect(small.views().map((v) => [v.id, v.present, v.view])).toEqual([[1, true, 't0,0']]);
      // across t0,0's own right edge (720 px) inside the crop: t1,0 holds it whole, so t0,0 starts nothing
      const inner = new FaceTracks(editedAll());
      call(inner, [at(680, 80)], 0, t00);
      expect(inner.views()).toHaveLength(0);
      call(inner, [at(680, 80)], 33, t10);
      expect(inner.views().map((v) => v.view)).toEqual(['t1,0']);
    });
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
