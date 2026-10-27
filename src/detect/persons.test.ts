// src/detect/persons.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { adapt } from '../tracking/adapter111';
import type { BodyField, PersonMask, Pose33, Rect } from '../types';
import { boxIoU, prepareFaces } from './faces';
import { aboutSize, hitPerson, matchHandOver, pairCost, pairPersons, primaryOf, seedPrimary } from './persons';

const fx = (n: string) => JSON.parse(readFileSync(new URL(`../../tests/fixtures/${n}`, import.meta.url), 'utf8'));
const group = fx('group_faces.landmarks.json') as { width: number; height: number; faces: number[][] };
const poses = fx('group_faces.pose.json') as { poses: { points: number[] }[] };
const prepared = prepareFaces(group.faces.map((f) => ({ points: new Float32Array(f) })), group.width, group.height);
const aspect = group.width / group.height;

/** a pose whose face points sit on the face's own landmarks (a perfect pair) */
function poseOn(face: ReturnType<typeof adapt>, vis = 0.99): Pose33 {
  const P = face.pts111;
  const points = new Float32Array(33 * 4);
  const set = (i: number, k: number) => {
    points[i * 4] = P[k * 2];
    points[i * 4 + 1] = P[k * 2 + 1];
    points[i * 4 + 3] = vis;
  };
  set(0, 46);
  set(2, 105); // the pose's left eye is the image right: matched by side, not by index
  set(5, 104);
  set(9, 90);
  set(10, 84);
  for (let i = 11; i < 33; i++) {
    points[i * 4] = P[46 * 2];
    points[i * 4 + 1] = P[46 * 2 + 1] + 0.05 + i * 0.01;
    points[i * 4 + 3] = vis;
  }
  return { points };
}

describe('pairPersons (S §3.4 P4)', () => {
  it('pairs each recorded face with the pose built on it, 1:1, eyes matched by image side (B is mirrored)', () => {
    const bodies = prepared.faces.map((f, i) => ({ id: `b${i}`, pose: poseOn(f.face), mask: null }));
    expect(pairPersons(prepared.faces, bodies.slice().reverse(), aspect).sort()).toEqual(prepared.faces.map((f, i) => [f.id, `b${i}`]));
  });
  it('fewer than 3 visible points: no pair', () => {
    const f = prepared.faces[0];
    const pose = poseOn(f.face);
    for (const i of [0, 2, 5]) pose.points[i * 4 + 3] = 0.1;
    expect(pairCost(f.face, pose, aspect)).toBeNull();
  });
  it('one face and one pose whose nose lies in the face box padded by 25 % pair whatever the cost (A14)', () => {
    const f = prepared.faces[0];
    const pose = poseOn(f.face);
    // far off: four of the five points 0.5 face widths away ≈ 0.4 FW mean ≈ 0.9 IOD (pupils ≈ 0.45 FW apart): cost > 0.5
    for (const i of [2, 5, 9, 10]) pose.points[i * 4] += f.box.w * 0.5;
    expect(pairCost(f.face, pose, aspect)!).toBeGreaterThan(0.5);
    expect(pairPersons([f], [{ id: 'b0', pose, mask: null }], aspect)).toEqual([[f.id, 'b0']]);
    expect(pairPersons([f, prepared.faces[1]], [{ id: 'b0', pose, mask: null }], aspect)).toEqual([]);
  });
  it('the recorded group poses pair with A and B when MediaPipe found their bodies', () => {
    const bodies = poses.poses.map((p, i) => ({ id: `b${i}`, pose: { points: new Float32Array(p.points) }, mask: null }));
    const pairs = pairPersons(prepared.faces, bodies, aspect);
    expect(pairs.length).toBeGreaterThanOrEqual(1);
    expect(new Set(pairs.map(([f]) => f)).size).toBe(pairs.length);
  });
});

describe('primaryOf, seedPrimary', () => {
  it('the primary is A (largest × most central, selectPerson’s score)', () => {
    const persons = prepared.faces.map((f) => ({ id: f.id, face: f.id, body: null }));
    expect(primaryOf(persons, prepared.faces, [])).toBe('f0');
  });
  it('without faces the body box decides', () => {
    const body = (cx: number) => ({ points: new Float32Array(33 * 4).map((_, k) => (k % 4 === 0 ? cx + ((k / 4) % 2) * 0.1 : k % 4 === 1 ? 0.1 + (k / 4) * 0.02 : 1)) });
    expect(primaryOf([{ id: 'b0', face: null, body: 'b0' }, { id: 'b1', face: null, body: 'b1' }], [], [{ id: 'b0', pose: body(0.05) }, { id: 'b1', pose: body(0.45) }])).toBe('b1');
  });
  it('seedPrimary: padded-box containment, the nearest centre among several, null for none', () => {
    const faces = [
      { id: 'f0', box: { x: 0.1, y: 0.4, w: 0.2, h: 0.2 } },
      { id: 'f1', box: { x: 0.32, y: 0.4, w: 0.2, h: 0.2 } },
    ];
    expect(seedPrimary({ x: 0.2, y: 0.5 }, faces)).toBe('f0');
    expect(seedPrimary({ x: 0.3, y: 0.5 }, faces)).toBe('f0'); // inside both padded boxes (f1's starts at 0.27), nearer f0's centre
    expect(seedPrimary({ x: 0.34, y: 0.5 }, faces)).toBe('f1'); // inside both, nearer f1's centre
    expect(seedPrimary({ x: 0.9, y: 0.1 }, faces)).toBeNull();
  });
});

describe('hitPerson (S §2.3)', () => {
  const ctx = {
    faces: [
      { person: 'f0', box: { x: 0.1, y: 0.3, w: 0.2, h: 0.2 } },
      { person: 'f1', box: { x: 0.5, y: 0.3, w: 0.02, h: 0.02 } },
    ],
    minW: 0.1,
    minH: 0.1,
  };
  it('faces first: the padded box, expanded to 44 pt at this zoom', () => {
    expect(hitPerson([0.2, 0.4], ctx)).toBe('f0');
    expect(hitPerson([0.54, 0.31], ctx)).toBe('f1'); // a tiny face is hit within its 44 pt
    expect(hitPerson([0.54, 0.31], { ...ctx, minW: 0.01, minH: 0.01 })).toBeNull(); // zoomed in 10×
  });
  it('maps display → source through the body field first', () => {
    const d = Math.fround(0.3);
    const field: BodyField = { width: 2, height: 2, data: new Float32Array([d, 0, d, 0, d, 0, d, 0]), version: 1 };
    expect(hitPerson([-0.1 + 0.001, 0.4], { ...ctx, field })).toBe('f0');
  });
  it('bodies (美體 only, when no face was hit): the highest mask value, equal values → the smaller mask', () => {
    const full = (v: number): PersonMask => ({ width: 4, height: 4, data: new Uint8Array(16).fill(v) });
    const half: PersonMask = { width: 4, height: 4, data: new Uint8Array(16).map((_, i) => (i % 4 < 2 ? 200 : 0)) };
    const bodies = [
      { person: 'b0', mask: full(200), box: { x: 0, y: 0, w: 1, h: 1 } },
      { person: 'b1', mask: half, box: { x: 0, y: 0, w: 0.5, h: 1 } },
    ];
    expect(hitPerson([0.1, 0.9], { ...ctx, bodies })).toBe('b1');
    expect(hitPerson([0.9, 0.9], { ...ctx, bodies })).toBe('b0');
    expect(hitPerson([0.9, 0.9], { ...ctx, bodies: [{ person: 'b2', mask: null, box: { x: 0.8, y: 0.8, w: 0.15, h: 0.15 } }] })).toBe('b2');
  });
});

describe('matchHandOver (camera per-person spec §5.4, K14)', () => {
  const f = (id: string, x: number) => ({ id, box: { x, y: 0.3, w: 0.1, h: 0.12 } });
  const faces = [f('f0', 0.1), f('f1', 0.4), f('f2', 0.7)];
  it('pairs by IoU ≥ 0.3 (best first), then by the padded centre with a face of about the box’s size (nearest first), one to one; the rest are missed', () => {
    // box 1: f1's size, its centre in f1's padded box, at IoU 0.1
    const r = matchHandOver([{ x: 0.11, y: 0.3, w: 0.1, h: 0.12 }, { x: 0.46, y: 0.37, w: 0.09, h: 0.1 }, { x: 0.9, y: 0.3, w: 0.05, h: 0.06 }], faces);
    expect(r).toEqual({ pairs: [[0, 'f0'], [1, 'f1']], missed: 1, lost: [2] });
    // round 6 (H4): a box 0.4 of f1's width inside it is not f1's, whatever its centre: missed and lost (retried)
    expect(matchHandOver([{ x: 0.43, y: 0.33, w: 0.04, h: 0.05 }], faces)).toEqual({ pairs: [], missed: 1, lost: [0] });
  });
  it('two camera persons on one face: the better IoU takes it, the other is missed, never given another face', () => {
    const r = matchHandOver([{ x: 0.42, y: 0.3, w: 0.1, h: 0.12 }, { x: 0.4, y: 0.3, w: 0.1, h: 0.12 }], faces);
    expect(r).toEqual({ pairs: [[1, 'f1']], missed: 1, lost: [0] });
  });
  it('ties keep the input order (boxes, then faces)', () => {
    const r = matchHandOver([{ x: 0.1, y: 0.3, w: 0.1, h: 0.12 }], [f('a', 0.1), f('b', 0.1)]);
    expect(r.pairs).toEqual([[0, 'a']]);
  });
  it('round 1 (C10): an obstacle claims the camera box on it, so the neighbour whose padded box holds its centre is not given it; that box is missed, not lost', () => {
    // a small face beside f1 (x 0.4–0.5, padded 0.375–0.525) the editor dropped (over its cap): its centre x 0.515 lies in f1's padded box
    const small = { x: 0.5, y: 0.33, w: 0.03, h: 0.04 };
    // without the obstacle (the small face under the editor's floor): lost, retried, not given f1 (round 6, H4: f1 took
    // it by the plain padded centre, a third of its width)
    expect(matchHandOver([small], faces)).toEqual({ pairs: [], missed: 1, lost: [0] });
    expect(matchHandOver([small], faces, [{ box: { x: 0.501, y: 0.331, w: 0.03, h: 0.04 } }])).toEqual({ pairs: [], missed: 1, lost: [] });
    // f1 claimed by its own camera box: the small box is left over, paired with nothing (the editor retries it)
    expect(matchHandOver([faces[1].box, small], faces)).toEqual({ pairs: [[0, 'f1']], missed: 1, lost: [1] });
  });
  it('round 2 (D6): a held box (missing at the shutter: a guess of where they were) pairs only by box IoU ≥ 0.3, after the found boxes’ IoU pairs, never by the padded centre', () => {
    const held = { x: 0.4, y: 0.3, w: 0.1, h: 0.12 };
    // a smaller face where the held person was: its padded box holds the box's centre, at IoU 0.1
    const stranger = [{ id: 'z', box: { x: 0.43, y: 0.33, w: 0.03, h: 0.04 } }];
    // a found box neither, since round 6 (H4): a face a third of its width is not theirs (round 2 gave it to a found box)
    expect(matchHandOver([held], stranger)).toEqual({ pairs: [], missed: 1, lost: [0] });
    expect(matchHandOver([held], stranger, [], [true])).toEqual({ pairs: [], missed: 1, lost: [0] });
    // the same face in the same place (a blink at the shutter): paired
    expect(matchHandOver([held], [{ id: 'f', box: { ...held, x: 0.405 } }], [], [true]).pairs).toEqual([[0, 'f']]);
    // within the IoU rule the captured frame's boxes come first: a found box at IoU ≥ 0.3 with a face takes it, whatever
    // the held box's IoU with it (round 3, E4: the centre rule no longer runs before the held boxes' IoU)
    const wide = { x: 0.4, y: 0.3, w: 0.2, h: 0.12 };
    const left = { x: 0.4, y: 0.3, w: 0.12, h: 0.12 };
    const right = { x: 0.5, y: 0.3, w: 0.1, h: 0.12 };
    expect(boxIoU(left, right)).toBeLessThan(0.3); // else shotPersons drops the held box
    expect(boxIoU(left, wide)).toBeGreaterThan(boxIoU(right, wide));
    expect(matchHandOver([left, right], [{ id: 'f', box: wide }], [], [true, false])).toEqual({ pairs: [[1, 'f']], missed: 1, lost: [0] });
  });
  it('round 3 (E4): every box pairs by IoU before any pairs by the padded centre: a held box on its own face keeps it from a found neighbour whose centre that face’s padded box holds', () => {
    const fA = { x: 0.4, y: 0.3, w: 0.1, h: 0.12 };
    const A = { x: 0.405, y: 0.305, w: 0.1, h: 0.12 }; // held at the shutter (a blink): the face of their size in their place
    const B = { x: 0.47, y: 0.31, w: 0.09, h: 0.1 }; // found beside A, partly behind; the editor missed B's own face
    // the precondition: IoU A–B under 0.3 (shotPersons keeps A), B's IoU with fA under 0.3, B's centre in fA's padded box
    expect(boxIoU(A, B)).toBeLessThan(0.3);
    expect(boxIoU(B, fA)).toBeLessThan(0.3);
    expect(boxIoU(A, fA)).toBeGreaterThan(0.8);
    expect(seedPrimary({ x: B.x + B.w / 2, y: B.y + B.h / 2 }, [{ id: 'fA', box: fA }])).toBe('fA');
    // A keeps fA; B is missed and lost (the editor retries B)
    expect(matchHandOver([A, B], [{ id: 'fA', box: fA }], [], [true, false])).toEqual({ pairs: [[0, 'fA']], missed: 1, lost: [1] });
    expect(matchHandOver([B, A], [{ id: 'fA', box: fA }], [], [false, true])).toEqual({ pairs: [[1, 'fA']], missed: 1, lost: [0] });
    // the same on an obstacle: A's IoU claims it before B's centre does, so B is lost, not given it
    expect(matchHandOver([A, B], [], [{ box: fA }], [true, false])).toEqual({ pairs: [], missed: 2, lost: [1] });
    // B's own face found too: each their own
    const fB = { x: 0.472, y: 0.31, w: 0.09, h: 0.1 };
    expect(matchHandOver([A, B], [{ id: 'fA', box: fA }, { id: 'fB', box: fB }], [], [true, false])).toEqual({ pairs: [[1, 'fB'], [0, 'fA']], missed: 0, lost: [] });
  });
  it('round 4 (F2): a stale box (unseen since a no-answer: not known missing, its box the last answer’s) left over pairs last by the padded centre too, with a face of about its size only; a held box never does', () => {
    const old = { x: 0.4, y: 0.3, w: 0.1, h: 0.12 };
    // their own face, moved 0.4 of a width diagonally since that answer: IoU 0.22, the box's centre in its padded box
    const moved = { id: 'f', box: { ...old, x: 0.44, y: 0.348 } };
    expect(boxIoU(old, moved.box)).toBeLessThan(0.3);
    expect(seedPrimary({ x: 0.45, y: 0.36 }, [moved])).toBe('f');
    expect(matchHandOver([old], [moved], [], [true], [true])).toEqual({ pairs: [[0, 'f']], missed: 0, lost: [] });
    // held (known missing): only by IoU, as before (D6)
    expect(matchHandOver([old], [moved], [], [true], [false])).toEqual({ pairs: [], missed: 1, lost: [0] });
    // D6's smaller stranger where they were (a third of their width): not theirs; neither is a face twice their width
    expect(matchHandOver([old], [{ id: 'z', box: { x: 0.43, y: 0.33, w: 0.03, h: 0.04 } }], [], [true], [true])).toEqual({ pairs: [], missed: 1, lost: [0] });
    expect(matchHandOver([old], [{ id: 'z', box: { x: 0.35, y: 0.24, w: 0.2, h: 0.24 } }], [], [true], [true])).toEqual({ pairs: [], missed: 1, lost: [0] });
    // within the TRACK_SIZE_JUMP gate (× 1.4): theirs
    expect(matchHandOver([old], [{ id: 'g', box: { x: 0.43, y: 0.318, w: 0.14, h: 0.168 } }], [], [true], [true]).pairs).toEqual([[0, 'g']]);
    // on an obstacle of their size: claimed by it, missed, not lost (C10)
    expect(matchHandOver([old], [], [{ box: moved.box }], [true], [true])).toEqual({ pairs: [], missed: 1, lost: [] });
  });
  it('round 5 (G3): a stale box keeps its moved face from a smaller found neighbour whose own face the editor missed, in either input order', () => {
    const old = { x: 0.4, y: 0.3, w: 0.1, h: 0.12 }; // stale: the last answer's box
    const moved = { id: 'f', box: { ...old, x: 0.44, y: 0.348 } }; // their own face, IoU 0.22 (F2's case)
    // B: found at the shutter, 0.6 of the face's width, partly behind A's lower right; the editor missed B's own face
    const B = { x: 0.525, y: 0.42, w: 0.06, h: 0.06 };
    // the preconditions: no IoU pair; both centres in the face's padded box, the stale one nearer; B not of its size
    expect([boxIoU(old, moved.box), boxIoU(B, moved.box), boxIoU(old, B)].every((v) => v < 0.3)).toBe(true);
    expect([seedPrimary({ x: 0.45, y: 0.36 }, [moved]), seedPrimary({ x: 0.555, y: 0.45 }, [moved])]).toEqual(['f', 'f']);
    expect(aboutSize(B, moved.box)).toBe(false);
    // A keeps their face; B is lost (the editor retries B). F2 ran the found boxes' plain centre pass first: B took it
    expect(matchHandOver([old, B], [moved], [], [true, false], [true, false])).toEqual({ pairs: [[0, 'f']], missed: 1, lost: [1] });
    expect(matchHandOver([B, old], [moved], [], [false, true], [false, true])).toEqual({ pairs: [[1, 'f']], missed: 1, lost: [0] });
    // held instead (known missing): IoU only; B, not of the face's size, takes it by no rule since round 6 (H4: B took
    // it by the plain padded centre, as in rounds 2–5), so both are lost and B is retried
    expect(matchHandOver([old, B], [moved], [], [true, false], [false, false])).toEqual({ pairs: [], missed: 2, lost: [0, 1] });
    // a found box of the face's size whose centre its padded box holds, farther than the stale box: since round 6 (H3)
    // the nearer box takes the face, found or stale (G3 gave it to the found box)
    const C = { x: 0.51, y: 0.38, w: 0.09, h: 0.1 };
    expect([boxIoU(C, moved.box) < 0.3, aboutSize(C, moved.box), seedPrimary({ x: 0.555, y: 0.43 }, [moved])]).toEqual([true, true, 'f']);
    expect(Math.hypot(0.555 - 0.49, 0.43 - 0.408)).toBeGreaterThan(Math.hypot(0.45 - 0.49, 0.36 - 0.408));
    expect(matchHandOver([old, C], [moved], [], [true, false], [true, false])).toEqual({ pairs: [[0, 'f']], missed: 1, lost: [1] });
  });
  describe('round 6: the padded-centre rule pairs a box only with a face of about its size, the nearest box first, found or stale', () => {
    const old = { x: 0.4, y: 0.3, w: 0.1, h: 0.12 }; // A's last answer's box
    const moved = { id: 'f', box: { ...old, x: 0.44, y: 0.348 } }; // A's own face, moved since (IoU 0.22: F2's case)
    const c = (b: Rect) => [b.x + b.w / 2, b.y + b.h / 2] as const;
    const d = (b: Rect) => Math.hypot(c(b)[0] - c(moved.box)[0], c(b)[1] - c(moved.box)[1]);
    it('H3: a stale person keeps their moved face from a neighbour of its size found at the shutter, partly behind them, whose own face the editor missed', () => {
      const B = { x: 0.5, y: 0.4, w: 0.1, h: 0.12 }; // the same size as A
      // the preconditions (the review's probe): no IoU pair, both centres in the face's padded box, both of its size, A nearer
      expect([boxIoU(old, moved.box), boxIoU(B, moved.box), boxIoU(old, B)].map((v) => +v.toFixed(4))).toEqual([0.2195, 0.1278, 0]);
      expect([seedPrimary({ x: c(old)[0], y: c(old)[1] }, [moved]), seedPrimary({ x: c(B)[0], y: c(B)[1] }, [moved])]).toEqual(['f', 'f']);
      expect([aboutSize(old, moved.box), aboutSize(B, moved.box)]).toEqual([true, true]);
      expect([+d(old).toFixed(4), +d(B).toFixed(4)]).toEqual([0.0625, 0.0794]);
      // A keeps their face; B is lost, so the editor retries B (G3 ran the found boxes' sized pass first: B took it)
      expect(matchHandOver([old, B], [moved], [], [true, false], [true, false])).toEqual({ pairs: [[0, 'f']], missed: 1, lost: [1] });
      expect(matchHandOver([B, old], [moved], [], [false, true], [false, true])).toEqual({ pairs: [[1, 'f']], missed: 1, lost: [0] });
    });
    it('H3: within the rule the nearer box goes first, either kind; at an equal distance the found box (exact binary distances)', () => {
      const F = { id: 'F', box: { x: 0.375, y: 0.25, w: 0.125, h: 0.125 } }; // centre (0.4375, 0.3125)
      const at = (x: number) => ({ x, y: 0.25, w: 0.125, h: 0.125 });
      const S = at(0.296875); // stale, 0.078125 left
      const Q = at(0.453125); // found, 0.078125 right
      for (const b of [S, Q]) expect([boxIoU(b, F.box) < 0.3, seedPrimary({ x: b.x + b.w / 2, y: 0.3125 }, [F])]).toEqual([true, 'F']);
      // a tie: the found box, in either input order
      expect(matchHandOver([S, Q], [F], [], [true, false], [true, false]).pairs).toEqual([[1, 'F']]);
      expect(matchHandOver([Q, S], [F], [], [false, true], [false, true]).pairs).toEqual([[0, 'F']]);
      // the stale box nearer (0.0703125, IoU 0.28): the stale one; the found box nearer: the found one
      expect(boxIoU(at(0.3046875), F.box)).toBeLessThan(0.3);
      expect(matchHandOver([at(0.3046875), Q], [F], [], [true, false], [true, false]).pairs).toEqual([[0, 'F']]);
      expect(matchHandOver([S, at(0.4453125)], [F], [], [true, false], [true, false]).pairs).toEqual([[1, 'F']]);
    });
    it('H4: a found box takes no face of another size by the padded centre: a smaller neighbour partly behind a held person who moved, whose own face the editor missed, is lost (retried for its own face)', () => {
      const B = { x: 0.525, y: 0.42, w: 0.06, h: 0.06 }; // found, 0.6 of the face's width (G3's neighbour)
      expect([boxIoU(B, moved.box) < 0.3, seedPrimary({ x: c(B)[0], y: c(B)[1] }, [moved]), aboutSize(B, moved.box)]).toEqual([true, 'f', false]);
      // A held (a blink at the shutter, then a move): IoU only. Rounds 2–5 gave B A's face by the plain padded centre
      expect(matchHandOver([old, B], [moved], [], [true, false], [false, false])).toEqual({ pairs: [], missed: 2, lost: [0, 1] });
      expect(matchHandOver([B], [moved])).toEqual({ pairs: [], missed: 1, lost: [0] });
      // twice its width around it: neither
      expect(matchHandOver([B], [{ id: 'g', box: { x: 0.495, y: 0.39, w: 0.12, h: 0.12 } }]).pairs).toEqual([]);
      // its own face, of its size, beside A's: B's
      expect(matchHandOver([old, B], [moved, { id: 'b', box: { ...B, x: 0.53 } }], [], [true, false], [false, false]).pairs).toEqual([[1, 'b']]);
    });
    it('H6: of two found boxes after one face, the one of its size takes it though the other is nearer (a single nearest-first pass gave it to the nearer)', () => {
      const B = { x: 0.41, y: 0.411, w: 0.06, h: 0.06 }; // nearer, 0.6 of the face's width
      const C = { x: 0.51, y: 0.38, w: 0.09, h: 0.1 }; // farther, of its size
      expect([boxIoU(B, moved.box) < 0.3, boxIoU(C, moved.box) < 0.3, boxIoU(B, C)]).toEqual([true, true, 0]);
      expect([seedPrimary({ x: c(B)[0], y: c(B)[1] }, [moved]), seedPrimary({ x: c(C)[0], y: c(C)[1] }, [moved])]).toEqual(['f', 'f']);
      expect([aboutSize(B, moved.box), aboutSize(C, moved.box)]).toEqual([false, true]);
      expect(d(B)).toBeLessThan(d(C));
      expect(matchHandOver([B, C], [moved])).toEqual({ pairs: [[1, 'f']], missed: 1, lost: [0] });
      expect(matchHandOver([C, B], [moved])).toEqual({ pairs: [[0, 'f']], missed: 1, lost: [1] });
    });
  });
});
