import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ovalBox } from '../engine/passes/faceCap';
import { adapt } from '../tracking/adapter111';
import type { CachedObstacle, Face, Landmarks478, Rect } from '../types';
import { buildCache, withMoreFaces } from './cache';
import { boxIoU, prepareFaces, prepareWith, sameHead } from './faces';
import { headOf, MEASURED_MARKS, OTHER_HEAD_PAIRS, SAME_HEAD_PAIRS } from './testHeadPairs';
import { retake, ringHolds, sampleFaceAt } from './testMeshes';

const fx = (n: string) => JSON.parse(readFileSync(new URL(`../../tests/fixtures/${n}`, import.meta.url), 'utf8'));
const sample = fx('landmarks_sample_face.json') as { points: number[] };

/** the recorded sample face moved so its points' bbox is centred at (cx, cy) with width w (UV), same aspect */
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

describe('prepareFaces (S §3.4 T3)', () => {
  it('orders by box centre x, ids f0…, boxes are oval bboxes in [0,1]', () => {
    const r = prepareFaces([lmAt(0.7, 0.5, 0.2), lmAt(0.3, 0.5, 0.2)], 1000, 1000);
    expect(r.faces.map((f) => f.id)).toEqual(['f0', 'f1']);
    expect(r.faces[0].box.x + r.faces[0].box.w / 2).toBeLessThan(0.5);
    for (const f of r.faces) expect(f.box.x >= 0 && f.box.x + f.box.w <= 1).toBe(true);
    expect(r.dropped).toEqual({ tooSmall: 0, overCap: 0 });
  });
  it('drops a duplicate (IoU > 0.6) entirely, before the size filter', () => {
    const r = prepareFaces([lmAt(0.5, 0.5, 0.2), lmAt(0.51, 0.5, 0.2)], 1000, 1000);
    expect(r.faces).toHaveLength(1);
    expect(r.obstacles).toHaveLength(0);
  });
  it('faces narrower than MIN_FACE_FRAC of the short edge become obstacles (tooSmall)', () => {
    const r = prepareFaces([lmAt(0.3, 0.5, 0.2), lmAt(0.8, 0.8, 0.02)], 1000, 1000);
    expect(r.faces).toHaveLength(1);
    expect(r.obstacles).toHaveLength(1);
    expect(r.obstacles[0].oval).toHaveLength(72);
    expect(r.dropped.tooSmall).toBe(1);
  });
  it('beyond the cap the largest are kept; the rest are obstacles (overCap)', () => {
    const lms = [0.1, 0.3, 0.5, 0.7, 0.9].map((x, i) => lmAt(x, 0.5, 0.08 + i * 0.01));
    const r = prepareFaces(lms, 1000, 1000, 3);
    expect(r.faces).toHaveLength(3);
    expect(r.faces.map((f) => Math.round((f.box.x + f.box.w / 2) * 10) / 10)).toEqual([0.5, 0.7, 0.9]);
    expect(r.dropped.overCap).toBe(2);
    expect(r.obstacles).toHaveLength(2);
  });
  it('the default cap is MAX_EDIT_FACES = 10: eleven faces keep the ten largest as f0…f9, the eleventh an obstacle (S §6.7)', () => {
    // a top row of six faces and a bottom row of five, 0.06–0.1 wide; the smallest (0.05) is the top row's fourth
    const top = [0.06, 0.065, 0.07, 0.05, 0.075, 0.08].map((w, i) => lmAt(0.08 + i * 0.16, 0.3, w));
    const bottom = [0.085, 0.09, 0.095, 0.1, 0.062].map((w, i) => lmAt(0.16 + i * 0.16, 0.7, w));
    const lms = [...top, ...bottom];
    expect(lms).toHaveLength(11);
    const r = prepareFaces(lms, 1000, 1000);
    expect(r.faces.map((f) => f.id)).toEqual(['f0', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9']);
    // left to right: the dropped face's x (0.56) is missing between f5 (0.48) and f6 (0.64)
    expect(r.faces.map((f) => Math.round((f.box.x + f.box.w / 2) * 100) / 100)).toEqual([0.08, 0.16, 0.24, 0.32, 0.4, 0.48, 0.64, 0.72, 0.8, 0.88]);
    expect(r.dropped).toEqual({ tooSmall: 0, overCap: 1 });
    expect(r.obstacles).toHaveLength(1);
    const o = r.obstacles[0].box;
    expect(Math.round((o.x + o.w / 2) * 100) / 100).toBe(0.56);
    expect(Math.round((o.y + o.h / 2) * 10) / 10).toBe(0.3);
  });
  it('every face a full detection (EDIT_DETECT_FACES = 12) drops is an obstacle: one kept face and eleven too small (A1, S §6.7)', () => {
    const tiny = Array.from({ length: 11 }, (_, i) => lmAt(0.04 + (i % 6) * 0.18, i < 6 ? 0.1 : 0.9, 0.02));
    const r = prepareFaces([lmAt(0.5, 0.5, 0.2), ...tiny], 1000, 1000);
    expect(r.faces.map((f) => f.id)).toEqual(['f0']);
    expect(r.dropped).toEqual({ tooSmall: 11, overCap: 0 });
    expect(r.obstacles).toHaveLength(11);
  });
  it('drops non-finite or collapsed faces before they get an id (Review Focus #1)', () => {
    const bad = lmAt(0.3, 0.5, 0.2);
    bad.points[5] = Number.NaN;
    const flat: Landmarks478 = { points: new Float32Array(478 * 3).fill(0.5) };
    const r = prepareFaces([bad, flat, lmAt(0.7, 0.5, 0.2)], 1000, 1000);
    expect(r.faces.map((f) => f.id)).toEqual(['f0']);
    expect(r.faces[0].box.x).toBeGreaterThan(0.5);
    expect(r.obstacles).toHaveLength(0);
  });
  it('the recorded group_faces.png gives A, B and C; D (if MediaPipe saw it) is an obstacle', () => {
    const j = fx('group_faces.landmarks.json') as { width: number; height: number; faces: number[][] };
    const r = prepareFaces(j.faces.map((f) => ({ points: new Float32Array(f) })), j.width, j.height);
    expect(r.faces.map((f) => Math.round((f.box.x + f.box.w / 2) * 20) / 20)).toEqual([0.2, 0.55, 0.8]);
    expect(r.obstacles.length).toBe(j.faces.length - 3);
  });
  it('boxIoU', () => {
    expect(boxIoU({ x: 0, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 1, h: 1 })).toBe(1);
    expect(boxIoU({ x: 0, y: 0, w: 1, h: 1 }, { x: 2, y: 2, w: 1, h: 1 })).toBe(0);
  });
});

/** a prepared face as an obstacle keeps it: its box and ring, no landmarks */
const obstacleOf = (f: { box: Rect; face: Face }): CachedObstacle => ({ box: f.box, oval: f.face.oval });
/** a face prepared alone in a width × height photo (1000 × 1000 unless given) */
const prep = (l: Landmarks478, width = 1000, height = 1000) => prepareFaces([l], width, height).faces[0];
const pt = (l: Float32Array, i: number): [number, number] => [l[i * 3], l[i * 3 + 1]];
/** the tests' own eye span: outer eye corners 33 and 263, in 3D pixels (z as MediaPipe scales it, by the width) */
const spanOf = (l: Float32Array, width: number, height: number) => Math.hypot((l[99] - l[789]) * width, (l[100] - l[790]) * height, (l[101] - l[791]) * width);
/** how far apart landmark i of two meshes lies, over the larger eye span (2D) */
function gap(a: Float32Array, b: Float32Array, i: number, width = 1000, height = 1000): number {
  return Math.hypot((a[i * 3] - b[i * 3]) * width, (a[i * 3 + 1] - b[i * 3 + 1]) * height) / Math.max(spanOf(a, width, height), spanOf(b, width, height));
}
const meanGap = (a: Float32Array, b: Float32Array, width = 1000, height = 1000) => MEASURED_MARKS.reduce((s, i) => s + gap(a, b, i, width, height), 0) / MEASURED_MARKS.length;

/** the convex hull of a mesh's points (x, y interleaved): the silhouette its face shows */
function hullOf(l: Float32Array): Float32Array {
  const p = Array.from({ length: 478 }, (_, i) => pt(l, i)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (q: number[][]) => {
    const h: number[][] = [];
    for (const r of q) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], r) <= 0) h.pop();
      h.push(r);
    }
    return h.slice(0, -1);
  };
  return new Float32Array([...half(p), ...half([...p].reverse())].flat());
}
/** how far `p` lies outside the ring (0 inside it) */
function clearOf(ring: Float32Array, p: readonly [number, number]): number {
  if (ringHolds(ring, p)) return 0;
  let d = Infinity;
  const n = ring.length >> 1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const [ax, ay, bx, by] = [ring[i * 2], ring[i * 2 + 1], ring[j * 2], ring[j * 2 + 1]];
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * (bx - ax) + (p[1] - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2 || 1)));
    d = Math.min(d, Math.hypot(p[0] - ax - t * (bx - ax), p[1] - ay - t * (by - ay)));
  }
  return d;
}
/**
 * the oracle: a face behind `front` (its silhouette) shows as a person, its nose tip and one whole eye (both corners)
 * clear of it by a quarter of its eye span. It reads where the face's nose and eyes are, never what sameHead compares
 */
function shows(l: Float32Array, front: Float32Array): boolean {
  const c = spanOf(l, 1000, 1000) / 4000;
  const out = (i: number) => clearOf(front, pt(l, i)) >= c;
  return out(1) && ((out(33) && out(133)) || (out(362) && out(263)));
}
/** the part of a face's oval inside another face's silhouette `front` (sampled) */
function hiddenIn(oval: Float32Array, front: Float32Array): number {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < oval.length; i += 2) [x0, x1, y0, y1] = [Math.min(x0, oval[i]), Math.max(x1, oval[i]), Math.min(y0, oval[i + 1]), Math.max(y1, oval[i + 1])];
  let inside = 0;
  let hid = 0;
  for (let i = 0; i < 60; i++) {
    for (let j = 0; j < 60; j++) {
      const p: [number, number] = [x0 + ((i + 0.5) / 60) * (x1 - x0), y0 + ((j + 0.5) / 60) * (y1 - y0)];
      if (!ringHolds(oval, p)) continue;
      inside++;
      if (ringHolds(front, p)) hid++;
    }
  }
  return hid / inside;
}

/** a short-range cache of `faces` (1000 × 1000, scanned upright): what a completion merges into */
const shortCache = (faces: Landmarks478[]) => ({
  ...buildCache({ width: 1000, height: 1000 }, prepareFaces(faces, 1000, 1000), null, { faceScans: [{ quarter: 0 as const, flipH: false, detector: 'short-range' as const }] }),
  photoDetector: 'short-range' as const,
});

describe('sameHead (step-1 spec §6.5): landmarks that coincide, measured on both detectors', () => {
  it('measured: the two detectors\' meshes of one head are one head (close-ups, a face cut by each edge or a corner, two faces with one cut, a group\'s face, a face behind another, boxed apart or alike)', () => {
    for (const p of SAME_HEAD_PAIRS) {
      const [a, b] = [headOf(p.full), headOf(p.short)];
      expect(sameHead(a, b, p.width, p.height), p.what).toBe(true);
      expect(sameHead(b, a, p.width, p.height), p.what).toBe(true);
    }
    // the pairs reach both clauses: boxed apart (IoU ≤ 0.6), and boxed alike with marks over 0.18 apart
    expect(SAME_HEAD_PAIRS.filter((p) => p.measured.iou <= 0.6)).toHaveLength(1);
    expect(SAME_HEAD_PAIRS.filter((p) => p.measured.marks >= 0.18).length).toBeGreaterThanOrEqual(3);
    expect(SAME_HEAD_PAIRS.filter((p) => p.measured.spans > 1.4).length).toBeGreaterThanOrEqual(1);
  });
  it('measured: different heads are two heads, where round 4 merged them (G1 a face of one size behind a cheek, G2 a child in front), where the noses nearly coincide and where the boxes overlap past 0.6', () => {
    for (const p of OTHER_HEAD_PAIRS) {
      const [a, b] = [headOf(p.full), headOf(p.short)];
      expect(sameHead(a, b, p.width, p.height), p.what).toBe(false);
      expect(sameHead(b, a, p.width, p.height), p.what).toBe(false);
    }
    expect(OTHER_HEAD_PAIRS.filter((p) => p.round4).length).toBeGreaterThanOrEqual(5);
    // a child's nose in front of a parent's: the noses 0.02–0.06 eye spans apart, which no nose distance tells apart
    const noses = OTHER_HEAD_PAIRS.map((p) => gap(headOf(p.full).lm, headOf(p.short).lm, 1, p.width, p.height));
    expect(Math.min(...noses)).toBeLessThan(0.06);
    expect(OTHER_HEAD_PAIRS.some((p) => p.measured.iou > 0.6)).toBe(true);
    expect(OTHER_HEAD_PAIRS.some((p) => p.hidden >= 0.55)).toBe(true);
  });
  it('the measured pairs, rounded, keep what their scenes measured; the one constructed pair is the sample mesh it names', () => {
    for (const p of [...SAME_HEAD_PAIRS, ...OTHER_HEAD_PAIRS]) {
      const [a, b] = [headOf(p.full), headOf(p.short)];
      expect(meanGap(a.lm, b.lm, p.width, p.height), p.what).toBeCloseTo(p.measured.marks, 2);
      const [sa, sb] = [spanOf(a.lm, p.width, p.height), spanOf(b.lm, p.width, p.height)];
      expect(Math.max(sa, sb) / Math.min(sa, sb), p.what).toBeCloseTo(p.measured.spans, 1);
      expect(boxIoU(a.box, b.box), p.what).toBeCloseTo(p.measured.iou, 2);
      expect(p.delegate === null, p.what).toBe(p.built !== undefined);
    }
    const built = [...SAME_HEAD_PAIRS, ...OTHER_HEAD_PAIRS].filter((p) => p.built);
    expect(built).toHaveLength(1);
    for (const p of built) {
      const faces = p.built!.map((args) => prep(sampleFaceAt(...args)));
      faces.forEach((f, k) => {
        const m = k === 0 ? p.full : p.short;
        [f.box.x, f.box.y, f.box.w, f.box.h].forEach((v, i) => expect(Math.abs(v - m.box[i]), `${p.what} box ${i}`).toBeLessThan(1e-5));
        MEASURED_MARKS.forEach((l, i) => {
          for (let j = 0; j < 3; j++) expect(Math.abs(f.lm[l * 3 + j] - m.marks[i * 3 + j]), `${p.what} landmark ${l}`).toBeLessThan(1e-5);
        });
      });
    }
  });
  it('a face without landmarks (an obstacle: its box and ring) is one head with another only boxed as it (IoU > 0.6), never by a ring centre inside a face (round 5)', () => {
    const a = prep(sampleFaceAt(0.5, 0.5, 0.36));
    // the centre of B's ring's bounds lies inside A's face oval (round 4 took it for B's nose), B's nose outside it: as an
    // obstacle B stays somebody else
    const lb = sampleFaceAt(0.675, 0.53, 0.36, { mirror: true });
    const b = prep(lb);
    const ob = obstacleOf(b);
    const xs = b.face.oval.filter((_, i) => i % 2 === 0);
    const ys = b.face.oval.filter((_, i) => i % 2 === 1);
    expect(ringHolds(a.face.oval, [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2])).toBe(true);
    expect(ringHolds(a.face.oval, pt(lb.points, 1))).toBe(false);
    expect(sameHead(a, ob, 1000, 1000)).toBe(false);
    expect(sameHead(ob, obstacleOf(a), 1000, 1000)).toBe(false);
    // boxed as one face (IoU > 0.6): one head, with landmarks or without
    const c = prep(retake(sampleFaceAt(0.5, 0.5, 0.36), { dx: 0.05 }));
    expect(boxIoU(a.box, c.box)).toBeGreaterThan(0.6);
    expect(sameHead(a, obstacleOf(c), 1000, 1000)).toBe(true);
    expect(sameHead(obstacleOf(c), obstacleOf(a), 1000, 1000)).toBe(true);
    // landmarks with no eye span (no real mesh): the box rule
    const flat = { box: a.box, lm: new Float32Array(478 * 3).fill(0.5) };
    expect(sameHead(flat, { box: c.box, lm: c.lm }, 1000, 1000)).toBe(true);
    expect(sameHead(flat, b, 1000, 1000)).toBe(false);
  });
  it('one head: a mesh of it scaled 1.3× about the nose (boxed apart, IoU under 0.6) or moved a tenth of an eye span; a neighbour cheek to cheek is somebody else', () => {
    const la = sampleFaceAt(0.5, 0.5, 0.4);
    const a = prep(la);
    const big = prep(retake(la, { scale: 1.3 }));
    expect(boxIoU(a.box, big.box)).toBeLessThan(0.6);
    expect(sameHead(a, big, 1000, 1000)).toBe(true);
    expect(sameHead(big, a, 1000, 1000)).toBe(true);
    expect(sameHead(a, prep(retake(la, { dx: 0.1, dy: -0.05 })), 1000, 1000)).toBe(true);
    // the same head 1.6× larger is no mesh either detector gives of it (their eye spans: within 1.27 of each other with
    // no face over it)
    expect(sameHead(a, prep(retake(la, { scale: 1.6 })), 1000, 1000)).toBe(false);
    const neighbour = prep(sampleFaceAt(0.2, 0.5, 0.28));
    expect(boxIoU(a.box, neighbour.box)).toBeGreaterThan(0);
    expect(sameHead(a, neighbour, 1000, 1000)).toBe(false);
  });
  it('F1 (round 4): a smaller friend a quarter behind the jaw, its nose showing, is somebody else; so is a mesh 0.4× a face\'s size inside it (round 3\'s E1 premise, which no real pair showed)', () => {
    const la = sampleFaceAt(0.5, 0.5, 0.4);
    const a = prep(la);
    const lb = sampleFaceAt(0.344, 0.604, 0.2);
    expect(shows(lb.points, hullOf(la.points))).toBe(true);
    expect(sameHead(a, prep(lb), 1000, 1000)).toBe(false);
    expect(prepareWith([lb], [a], 1000, 1000).faces.map((f) => Math.round((f.box.x + f.box.w / 2) * 100) / 100)).toEqual([0.34, 0.5]);
    // E1: the head "meshed small and off to its side" (IoU 0.14): the eye spans 2.5× apart, a smaller person
    expect(sameHead(a, prep(sampleFaceAt(0.64, 0.5, 0.16)), 1000, 1000)).toBe(false);
  });
  it('G1 (round 5): a neighbour of one size behind a cheek, its nose, an eye and its mouth showing, is somebody else: two faces in the D2 union, added by the completion', () => {
    const la = sampleFaceAt(0.5, 0.5, 0.36);
    const lb = sampleFaceAt(0.675, 0.53, 0.36, { mirror: true });
    const [a, b] = [prep(la), prep(lb)];
    // B's nose tip, the point above it, its image-right eye (362, 263: B is mirrored) and both mouth corners outside A's
    // face oval; boxed apart (IoU 0.31)
    for (const i of [1, 4, 362, 263, 61, 291]) expect(ringHolds(a.face.oval, pt(lb.points, i)), `landmark ${i}`).toBe(false);
    expect(ringHolds(a.face.oval, pt(lb.points, 33)), 'its image-left eye, behind A').toBe(true);
    expect(shows(lb.points, hullOf(la.points))).toBe(true);
    expect(boxIoU(a.box, b.box)).toBeCloseTo(0.31, 2);
    expect(sameHead(a, b, 1000, 1000)).toBe(false);
    expect(sameHead(b, a, 1000, 1000)).toBe(false);
    // D2: full-range found B and missed A, the seed's face, which short-range found (and the other way round)
    expect(prepareWith([lb], [a], 1000, 1000)).toMatchObject({ faces: [{ id: 'f0', lm: a.lm }, { id: 'f1' }], obstacles: [] });
    expect(prepareWith([la], [b], 1000, 1000).faces).toHaveLength(2);
    // the completion of a short-range [A]: full-range finds A and B; B is added
    const r = withMoreFaces(shortCache([la]), prepareFaces([la, lb], 1000, 1000));
    expect(r.added).toEqual(['f1']);
    expect(r.cache.faces.map((f) => f.id)).toEqual(['f0', 'f1']);
  });
  it('G1 at 3/4 views (round 5): a neighbour turned 30–45°, 0.6–1× the size, 45 % behind a temple or cheek with its nose and an eye showing, is somebody else (round 4 merged each)', () => {
    const la = sampleFaceAt(0.5, 0.5, 0.36);
    const a = prep(la);
    const hullA = hullOf(la.points);
    for (const [x, y, k, yaw, mirror] of [
      [0.36, 0.32, 0.6, -45, false],
      [0.64, 0.35, 0.8, 45, false],
      [0.34, 0.43, 1, -30, false],
      [0.35, 0.45, 1, 30, true],
    ] as const) {
      const lb = sampleFaceAt(x, y, 0.36 * k, { yaw, mirror });
      const b = prep(lb);
      const at = JSON.stringify({ x, y, k, yaw, mirror });
      expect(shows(lb.points, hullA), at).toBe(true);
      expect(hiddenIn(b.face.oval, hullA), at).toBeGreaterThan(0.4);
      expect(hiddenIn(b.face.oval, hullA), at).toBeLessThan(0.5);
      expect(boxIoU(a.box, b.box), at).toBeGreaterThan(0.1);
      expect(sameHead(a, prep(lb), 1000, 1000), at).toBe(false);
      expect(prepareWith([lb], [a], 1000, 1000).faces, at).toHaveLength(2);
      expect(withMoreFaces(shortCache([la]), prepareFaces([la, lb], 1000, 1000)).added, at).toEqual(['f1']);
    }
  });
  it("G2 (round 5): a child's face in front of a parent's cheek or chin is two faces, the parent's nose and eyes showing", () => {
    const lp = sampleFaceAt(0.5, 0.45, 0.4);
    const p = prep(lp);
    for (const [x, y, w] of [
      [0.64, 0.56, 0.22],
      [0.5, 0.66, 0.24],
      [0.68, 0.5, 0.26],
      [0.66, 0.55, 0.27],
    ]) {
      for (const mirror of [false, true]) {
        const lc = sampleFaceAt(x, y, w, { mirror });
        const c = prep(lc);
        const at = JSON.stringify({ x, y, w, mirror });
        // the child is in front: the parent's nose tip and both eyes show beside it
        const child = hullOf(lc.points);
        for (const i of [1, 33, 133, 362, 263]) expect(ringHolds(child, pt(lp.points, i)), `${at} landmark ${i}`).toBe(false);
        expect(sameHead(p, c, 1000, 1000), at).toBe(false);
        expect(sameHead(c, p, 1000, 1000), at).toBe(false);
        // D2 with the seed on the parent, whom full-range missed; and on the child
        expect(prepareWith([lc], [p], 1000, 1000).faces, at).toHaveLength(2);
        expect(prepareWith([lp], [c], 1000, 1000).faces, at).toHaveLength(2);
        expect(withMoreFaces(shortCache([lp]), prepareFaces([lp, lc], 1000, 1000)).added, at).toEqual(['f1']);
      }
    }
  });
  it('two 3/4 views turned towards each other: their other marks closer than one head\'s, their noses a third of an eye span apart: two heads', () => {
    const la = sampleFaceAt(0.5, 0.5, 0.3, { yaw: 30 });
    const lb = sampleFaceAt(0.62, 0.5, 0.3, { yaw: -30 });
    const [a, b] = [prep(la), prep(lb)];
    expect(boxIoU(a.box, b.box)).toBeLessThan(0.6);
    expect(meanGap(la.points, lb.points)).toBeLessThan(0.18);
    expect(gap(la.points, lb.points, 1)).toBeGreaterThan(0.3);
    expect(sameHead(a, b, 1000, 1000)).toBe(false);
  });
  it('sweep: a different head 0.4–1.25× a face\'s size, either at a front view or turned 30–45°, tilted and mirrored, never merges while the one behind shows its nose and an eye, nor through prepareWith and withMoreFaces at its most hidden such placement', () => {
    const wrong: string[] = [];
    let placed = 0;
    let showing = 0;
    let overlapped = 0;
    let piped = 0;
    for (const yawA of [0, 30, -45]) {
      for (const mirrorA of [false, true]) {
        const la = sampleFaceAt(0.5, 0.5, 0.3, { yaw: yawA, mirror: mirrorA });
        const a = prep(la);
        const hullA = hullOf(la.points);
        const cache = shortCache([la]);
        for (const k of [0.4, 0.6, 0.8, 1, 1.25]) {
          for (const yawB of [-45, -30, 0, 30, 45]) {
            for (const tiltB of [-20, 0, 20]) {
              for (const mirrorB of [false, true]) {
                const l0 = sampleFaceAt(0, 0, 0.3 * k, { yaw: yawB, tilt: tiltB, mirror: mirrorB }).points;
                const f0 = adapt({ points: l0 }, 1000, 1000);
                const h0 = hullOf(l0);
                const lb = new Float32Array(l0.length);
                const ob = new Float32Array(72);
                const hb = new Float32Array(h0.length);
                let most: { x: number; y: number; nose: number } | null = null;
                for (let x = 0.12; x <= 0.88; x += 0.02) {
                  for (let y = 0.12; y <= 0.88; y += 0.02) {
                    for (let i = 0; i < l0.length; i += 3) {
                      lb[i] = l0[i] + x;
                      lb[i + 1] = l0[i + 1] + y;
                      lb[i + 2] = l0[i + 2];
                    }
                    for (let i = 0; i < 72; i += 2) {
                      ob[i] = f0.oval[i] + x;
                      ob[i + 1] = f0.oval[i + 1] + y;
                    }
                    for (let i = 0; i < h0.length; i += 2) {
                      hb[i] = h0[i] + x;
                      hb[i + 1] = h0[i + 1] + y;
                    }
                    const box = ovalBox({ ...f0, oval: ob });
                    const iou = boxIoU(a.box, box);
                    if (iou === 0) continue;
                    placed++;
                    // B behind A, or A behind B: the one behind shows its nose and an eye
                    if (!shows(lb, hullA) && !shows(la.points, hb)) continue;
                    showing++;
                    if (iou >= 0.3) overlapped++;
                    if (sameHead(a, { box, lm: lb }, 1000, 1000) || sameHead({ box, lm: lb }, a, 1000, 1000)) wrong.push(JSON.stringify({ yawA, mirrorA, k, yawB, tiltB, mirrorB, x, y }));
                    const nose = Math.hypot(lb[3] - la.points[3], lb[4] - la.points[4]);
                    if (iou <= 0.6 && (!most || nose < most.nose)) most = { x, y, nose };
                  }
                }
                if (!most) continue;
                const at = JSON.stringify({ yawA, mirrorA, k, yawB, tiltB, mirrorB, x: most.x, y: most.y });
                const lbAt = sampleFaceAt(most.x, most.y, 0.3 * k, { yaw: yawB, tilt: tiltB, mirror: mirrorB });
                // the camera seed's union keeps both; the completion of a short-range [A] adds B
                if (prepareWith([lbAt], [a], 1000, 1000).faces.length !== 2) wrong.push(`prepareWith ${at}`);
                if (withMoreFaces(cache, prepareFaces([la, lbAt], 1000, 1000)).added.length !== 1) wrong.push(`withMoreFaces ${at}`);
                piped++;
              }
            }
          }
        }
      }
    }
    expect(wrong).toEqual([]);
    expect(placed).toBeGreaterThan(700_000);
    expect(showing).toBeGreaterThan(500_000);
    // placements boxed together like G1's (IoU 0.31) where the face behind still shows
    expect(overlapped).toBeGreaterThan(10_000);
    expect(piped).toBe(900);
  });
  it('sweep: one head as the other detector meshes it (scaled up to 1.14×, moved up to 0.08 eye spans, tilted 3° more), at a front view or turned up to 45°, tilted, mirrored, whole or cut by the frame, in a square or a 3:4 photo: one head, one face through prepareWith, nobody new through withMoreFaces', () => {
    const wrong: string[] = [];
    let pairs = 0;
    for (const [width, height] of [
      [1000, 1000],
      [1536, 2048],
    ]) {
      for (const yaw of [-45, -30, -15, 0, 15, 30, 45]) {
        for (const tilt of [-20, 0, 20]) {
          for (const mirror of [false, true]) {
            // whole and small, whole and large, 40 % past the left edge, the top 30 % above the frame
            for (const [cx, cy, w] of [
              [0.5, 0.5, 0.1],
              [0.5, 0.5, 0.5],
              [0.04, 0.5, 0.3],
              [0.5, 0.09, 0.3],
            ]) {
              const l = sampleFaceAt(cx, cy, w, { yaw, tilt, mirror, width, height });
              const f = prep(l, width, height);
              let first = true;
              for (const scale of [1 / 1.14, 1, 1.14]) {
                for (const [dx, dy] of [
                  [0, 0],
                  [0.08, 0],
                  [-0.08, 0],
                  [0, 0.08],
                  [0, -0.08],
                  [0.057, 0.057],
                ]) {
                  for (const turn of [-3, 3]) {
                    const lo = retake(l, { scale, dx, dy, tilt: turn }, width, height);
                    const o = prep(lo, width, height);
                    pairs++;
                    const at = JSON.stringify({ width, yaw, tilt, mirror, cx, cy, w, scale, dx, dy, turn });
                    if (!sameHead(f, o, width, height) || !sameHead(o, f, width, height)) wrong.push(at);
                    if (!first) continue;
                    first = false;
                    // D2: the short-range face on the seed's head stands for full-range's; a completion adds nobody
                    const u = prepareWith([lo], [f], width, height);
                    if (u.faces.length !== 1 || !u.faces[0].lm.every((v, i) => v === f.lm[i])) wrong.push(`prepareWith ${at}`);
                    const c = { ...buildCache({ width, height }, prepareFaces([l], width, height), null, { faceScans: [{ quarter: 0 as const, flipH: false }] }), photoDetector: 'short-range' as const };
                    if (withMoreFaces(c, prepareFaces([lo], width, height)).added.length) wrong.push(`withMoreFaces ${at}`);
                  }
                }
              }
            }
          }
        }
      }
    }
    expect(wrong).toEqual([]);
    expect(pairs).toBe(2 * 7 * 3 * 2 * 4 * 36);
  });
});

describe('prepareWith (D2, step-1 spec §6.5)', () => {
  it("the other detector's faces stand for each face on their heads; the union is numbered afresh", () => {
    // full-range: a neighbour, and the head meshed 1.3× larger about its nose (IoU under 0.6); the short-range face on it
    const head = sampleFaceAt(0.5, 0.5, 0.3);
    const full = [sampleFaceAt(0.2, 0.5, 0.2), retake(head, { scale: 1.3 })];
    const short = prepareFaces([head], 1000, 1000).faces;
    const centres = (r: ReturnType<typeof prepareFaces>) => r.faces.map((f) => Math.round((f.box.x + f.box.w / 2) * 100) / 100);
    // prepareFaces alone keeps both meshes of the head (IoU under 0.6)
    expect(prepareFaces([...full, head], 1000, 1000).faces).toHaveLength(3);
    const r = prepareWith(full, short, 1000, 1000);
    expect(centres(r)).toEqual([0.2, 0.5]);
    expect(r.faces.map((f) => f.id)).toEqual(['f0', 'f1']);
    expect(r.faces[1].lm).toEqual(short[0].lm);
    expect(r.obstacles).toEqual([]);
    // nothing on their heads: a plain union
    expect(centres(prepareWith([sampleFaceAt(0.2, 0.5, 0.2)], short, 1000, 1000))).toEqual([0.2, 0.5]);
  });
  it('a full-range face boxed as a duplicate of the seed\'s (IoU > 0.6) with its landmarks elsewhere gives way too: prepareFaces keeps one of the two, and the seed\'s is kept', () => {
    const a = prepareFaces([sampleFaceAt(0.5, 0.5, 0.3)], 1000, 1000).faces;
    const lb = sampleFaceAt(0.5, 0.57, 0.3);
    const b = prep(lb);
    expect(boxIoU(a[0].box, b.box)).toBeGreaterThan(0.6);
    expect(sameHead(a[0], b, 1000, 1000)).toBe(false);
    const r = prepareWith([lb], a, 1000, 1000);
    expect(r.faces).toHaveLength(1);
    expect(r.faces[0].lm).toEqual(a[0].lm);
    // a completion keeps the two as two faces: different heads, though boxed alike
    expect(withMoreFaces(shortCache([sampleFaceAt(0.5, 0.5, 0.3)]), prepareFaces([lb], 1000, 1000)).added).toEqual(['f1']);
  });
});
