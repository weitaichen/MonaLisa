import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { prepareFaces } from '../../detect/faces';
import { adapt } from '../../tracking/adapter111';
import {
  browGapAt,
  type EyeFrame,
  eyeFrames,
  eyeNoteInfo,
  eyeToUv,
  lashBlinkGate,
  lashSizeGate,
  lensBlinkGate,
  LID_STATIONS,
  lidStations,
  polyY,
  type Station,
  STATION_XS,
} from './eyeFrame';
import { closeEye, mirrorFaceX, scaleFace } from './syntheticFaces';

const lm = JSON.parse(readFileSync(new URL('../../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as {
  width: number;
  height: number;
  points: number[];
  mirrored: number[];
};
const aspect = lm.width / lm.height;
const face = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);
const frames = eyeFrames(face, aspect);
const P = (i: number): [number, number] => [face.pts111[i * 2], face.pts111[i * 2 + 1]];
// the step-5 makeup's station sets (眼影 upper piece and 睫毛; 眼影 lower accent)
const UPPER_XS = [-0.22, -0.14, -0.07, ...STATION_XS];
const LOWER_ACCENT_XS = [-0.15, -0.075, ...STATION_XS.filter((x) => x <= 0.5), 0.55];

describe('eyeFrames on the fixture face (face-detail spec §4.7)', () => {
  it('every Face.lids point lies on its lid polyline (eye units)', () => {
    frames.forEach((f, eye) => {
      for (let j = 0; j < 16; j++) {
        const qx = face.lids[(eye * 16 + j) * 2];
        const qy = face.lids[(eye * 16 + j) * 2 + 1] / aspect;
        const dx = qx - f.o[0];
        const dy = qy - f.o[1];
        const x = (dx * f.ex[0] + dy * f.ex[1]) / f.w;
        const y = (dx * f.ey[0] + dy * f.ey[1]) / f.w;
        const lid = j >= 9 ? f.lowerPts : f.upperPts;
        expect(Math.abs(polyY(lid, x) - y)).toBeLessThan(1e-6);
      }
    });
  });

  it('the eyes are open: h_k ≥ 0 everywhere and > 0.05 for k = 2…14', () => {
    for (const f of frames) {
      expect(f.upper.length).toBe(LID_STATIONS);
      for (let k = 0; k < LID_STATIONS; k++) {
        const h = f.lower[k] - f.upper[k];
        expect(h).toBeGreaterThanOrEqual(-1e-6);
        if (k >= 2 && k <= 14) expect(h).toBeGreaterThan(0.05);
      }
    }
  });

  it('brow gaps lie in [0.3, 1.2] eye units', () => {
    for (const f of frames) for (const g of f.browGap) {
      expect(g).toBeGreaterThan(0.3);
      expect(g).toBeLessThan(1.2);
    }
  });

  it('EAR is pinned (measured 0.463 left, 0.378 right)', () => {
    expect(Math.abs(frames[0].ear - 0.463)).toBeLessThan(0.02);
    expect(Math.abs(frames[1].ear - 0.378)).toBeLessThan(0.02);
  });

  it('the detected iris is valid and centred on p104 / p105 (r/w measured 0.255 and 0.214)', () => {
    const [l, r] = frames;
    expect(l.iris).not.toBeNull();
    expect(r.iris).not.toBeNull();
    expect(Math.abs(l.iris!.r / l.w - 0.255)).toBeLessThan(0.02);
    expect(Math.abs(r.iris!.r / r.w - 0.214)).toBeLessThan(0.02);
    expect(l.iris!.c[0]).toBeCloseTo(P(104)[0], 6);
    expect(l.iris!.c[1]).toBeCloseTo(P(104)[1] / aspect, 6);
    expect(l.irisFallback.r).toBeCloseTo(0.21 * l.w, 9);
  });

  it('eyeToUv maps the corners back to the GPUPixel eye corners', () => {
    const [l, r] = frames;
    for (const [f, outer, inner] of [
      [l, 52, 55],
      [r, 61, 58],
    ] as const) {
      const o = eyeToUv(f, 0, 0, aspect);
      const i = eyeToUv(f, 1, 0, aspect);
      expect(o[0]).toBeCloseTo(P(outer)[0], 6);
      expect(o[1]).toBeCloseTo(P(outer)[1], 6);
      expect(i[0]).toBeCloseTo(P(inner)[0], 6);
      expect(i[1]).toBeCloseTo(P(inner)[1], 6);
    }
  });

  it('lid stations: unit normals pointing away from the aperture', () => {
    for (const f of frames) {
      const up = lidStations(f, 'upper', UPPER_XS);
      const lo = lidStations(f, 'lower', LOWER_ACCENT_XS);
      for (const s of up) expect(s.ny).toBeLessThan(0);
      for (const s of lo) expect(s.ny).toBeGreaterThan(0);
      for (const s of [...up, ...lo]) expect(Math.hypot(s.nx, s.ny)).toBeCloseTo(1, 9);
    }
  });
});

/** the fixture face, its recorded mirrored landmarks and the three edit faces of group_faces.png */
function fixtureEyes(): { name: string; f: EyeFrame; eye: number }[] {
  const g = JSON.parse(readFileSync(new URL('../../../tests/fixtures/group_faces.landmarks.json', import.meta.url), 'utf8')) as {
    width: number;
    height: number;
    faces: number[][];
  };
  const group = prepareFaces(g.faces.map((p) => ({ points: new Float32Array(p) })), g.width, g.height).faces;
  if (group.length !== 3) throw new Error(`group_faces.png gave ${group.length} edit faces, expected 3`);
  const mirrored = adapt({ points: new Float32Array(lm.mirrored) }, lm.width, lm.height);
  const faces: [string, readonly EyeFrame[]][] = [
    ['sample', eyeFrames(face, aspect)],
    ['mirrored', eyeFrames(mirrored, aspect)],
    ...group.map((p, i): [string, readonly EyeFrame[]] => [`group ${i}`, eyeFrames(p.face, g.width / g.height)]),
  ];
  return faces.flatMap(([name, fs]) => fs.map((f, eye) => ({ name, f, eye })));
}

/** quads of the ribbon d ∈ [d0, d1] along the station normals whose two strip triangles do not keep the lid's winding */
function foldedQuads(sts: readonly Station[], lid: 'upper' | 'lower', d0: number, d1: number | ((s: Station) => number)): number[] {
  const top = typeof d1 === 'number' ? () => d1 : d1;
  const P = sts.map((s): [number, number] => [s.x + s.nx * d0, s.y + s.ny * d0]);
  const Q = sts.map((s): [number, number] => [s.x + s.nx * top(s), s.y + s.ny * top(s)]);
  const cross = (a: [number, number], b: [number, number], c: [number, number]) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const sign = lid === 'upper' ? -1 : 1;
  const out: number[] = [];
  for (let i = 0; i + 1 < sts.length; i++) {
    if (sign * cross(P[i], P[i + 1], Q[i]) <= 0 || sign * cross(P[i + 1], Q[i + 1], Q[i]) <= 0) out.push(sts[i].x);
  }
  return out;
}

describe('the outer-corner overhang (face-detail spec §4.7)', () => {
  const eyes = fixtureEyes();

  it('continues along the corner line: never below it for the upper lid, never above it for the lower lid', () => {
    for (const { f } of eyes) {
      // the lid's corner point is the frame origin
      expect(Math.abs(f.upperPts[1])).toBeLessThan(1e-6);
      expect(Math.abs(f.lowerPts[1])).toBeLessThan(1e-6);
      for (const s of lidStations(f, 'upper', UPPER_XS).filter((s) => s.x < 0)) {
        expect(s.y).toBeLessThanOrEqual(1e-9);
        expect(Math.abs(s.y - f.upperPts[1])).toBeLessThan(1e-9);
      }
      for (const s of lidStations(f, 'lower', LOWER_ACCENT_XS).filter((s) => s.x < 0)) {
        expect(s.y).toBeGreaterThanOrEqual(-1e-9);
        expect(Math.abs(s.y - f.lowerPts[1])).toBeLessThan(1e-9);
      }
      // the two overhangs do not cross
      const xs = [-0.15, -0.075, 0];
      const up = lidStations(f, 'upper', xs);
      const lo = lidStations(f, 'lower', xs);
      xs.forEach((_, i) => expect(lo[i].y - up[i].y).toBeGreaterThanOrEqual(-1e-9));
    }
  });

  it('is the same on both eyes of a face (upper y at x = −0.22 within 0.05)', () => {
    for (let i = 0; i < eyes.length; i += 2) {
      const [l, r] = [eyes[i].f, eyes[i + 1].f].map((f) => lidStations(f, 'upper', UPPER_XS)[0].y);
      expect(Math.abs(l - r)).toBeLessThan(0.05);
    }
  });

  it('leaves the lid stations alone and gives the overhang the corner normal', () => {
    for (const { f } of eyes) {
      for (const [lid, xs] of [
        ['upper', UPPER_XS],
        ['lower', LOWER_ACCENT_XS],
      ] as const) {
        const all = lidStations(f, lid, xs);
        const on = xs.filter((x) => x >= 0);
        expect(all.filter((s) => s.x >= 0)).toEqual(lidStations(f, lid, on));
        const corner = all.find((s) => s.x === 0)!;
        for (const s of all.filter((s) => s.x < 0)) expect([s.nx, s.ny]).toEqual([corner.nx, corner.ny]);
      }
    }
  });

  it('no 眼影, 睫毛 or lower-accent ribbon folds over the stations, up to the largest heights', () => {
    for (const { name, f, eye } of eyes) {
      const up = lidStations(f, 'upper', UPPER_XS);
      const lo = lidStations(f, 'lower', LOWER_ACCENT_XS);
      // 睫毛 d ∈ [0, Lh ≤ 0.20]; 眼影 upper d ∈ [−0.02, H] with H = 0.65·max(browGap, 0.25) (S5 §4.8), and any H ≤ 0.8;
      // lower accent d ∈ [−0.03, 0.10]
      const H = (s: Station) => 0.65 * Math.max(browGapAt(f, s.x, s.y), 0.25);
      expect({ name, eye, folds: foldedQuads(up, 'upper', 0, 0.2) }).toEqual({ name, eye, folds: [] });
      expect({ name, eye, folds: foldedQuads(up, 'upper', -0.02, H) }).toEqual({ name, eye, folds: [] });
      expect({ name, eye, folds: foldedQuads(up, 'upper', -0.02, 0.8) }).toEqual({ name, eye, folds: [] });
      expect({ name, eye, folds: foldedQuads(lo, 'lower', -0.03, 0.1) }).toEqual({ name, eye, folds: [] });
    }
  });
});

describe('closed, mirrored and tiny faces (face-detail spec §4.9, §8.1)', () => {
  it('a closed eye: EAR < 0.05, h = 0 at every station, both blink gates 0', () => {
    const closed = eyeFrames(closeEye(closeEye(face, 0), 1), aspect);
    for (const f of closed) {
      expect(f.ear).toBeLessThan(0.05);
      for (let k = 0; k < LID_STATIONS; k++) expect(Math.max(0, f.lower[k] - f.upper[k])).toBe(0);
      expect(lensBlinkGate(f.ear)).toBe(0);
      expect(lashBlinkGate(f.ear)).toBe(0);
      expect(f.iris).toBeNull();
    }
  });

  it('a horizontally mirrored face (x → 1 − x) gives the same eye-local frames', () => {
    const m = eyeFrames(mirrorFaceX(face), aspect);
    frames.forEach((f, eye) => {
      const g = m[eye];
      expect(g.o[0]).toBeCloseTo(1 - f.o[0], 6);
      expect(g.ear).toBeCloseTo(f.ear, 5);
      for (let k = 0; k < LID_STATIONS; k++) {
        expect(Math.abs(g.upper[k] - f.upper[k])).toBeLessThan(1e-5);
        expect(Math.abs(g.lower[k] - f.lower[k])).toBeLessThan(1e-5);
        expect(Math.abs(g.browGap[k] - f.browGap[k])).toBeLessThan(1e-5);
      }
    });
  });

  it('gates: the spec thresholds; the fixture passes; a face shrunk to 7 % fails the 睫毛 size gate', () => {
    expect([lensBlinkGate(0.15), lensBlinkGate(0.2), lashBlinkGate(0.08), lashBlinkGate(0.14)]).toEqual([0, 1, 0, 1]);
    expect(lensBlinkGate(0.175)).toBeCloseTo(0.5, 9);
    for (const f of frames) expect(lashSizeGate(f, aspect)).toBe(1);
    const tiny = eyeFrames(scaleFace(face, 0.07, [0.5, 0.5]), aspect);
    for (const f of tiny) expect(lashSizeGate(f, aspect)).toBe(0);
  });

  it('an implausible iris (moved far outside the eye) falls back to p104 / p105 with r = 0.21·w', () => {
    const bad = { ...face, iris: face.iris.map((v, i) => (i % 2 === 0 ? v : v + 0.2)) };
    const [l] = eyeFrames(bad, aspect);
    expect(l.iris).toBeNull();
    expect(l.irisFallback.c[0]).toBeCloseTo(P(104)[0], 6);
  });

  it('eyeNoteInfo drives the 美妝 strip notes', () => {
    expect(eyeNoteInfo(face, aspect)).toEqual({ lensClosed: false, lashesClosed: false, lashesSmall: false });
    expect(eyeNoteInfo(closeEye(closeEye(face, 0), 1), aspect)).toMatchObject({ lensClosed: true, lashesClosed: true });
    expect(eyeNoteInfo(closeEye(face, 0), aspect)).toMatchObject({ lensClosed: false, lashesClosed: false });
    expect(eyeNoteInfo(scaleFace(face, 0.07, [0.5, 0.5]), aspect).lashesSmall).toBe(true);
  });
});
