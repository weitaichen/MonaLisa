import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { adapt } from '../../tracking/adapter111';
import {
  eyeFrames,
  eyeNoteInfo,
  eyeToUv,
  lashBlinkGate,
  lashSizeGate,
  lensBlinkGate,
  LID_STATIONS,
  lidStations,
  polyY,
  STATION_XS,
} from './eyeFrame';
import { closeEye, mirrorFaceX, scaleFace } from './syntheticFaces';

const lm = JSON.parse(readFileSync(new URL('../../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as {
  width: number;
  height: number;
  points: number[];
};
const aspect = lm.width / lm.height;
const face = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);
const frames = eyeFrames(face, aspect);
const P = (i: number): [number, number] => [face.pts111[i * 2], face.pts111[i * 2 + 1]];

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

  it('lid stations: normals point away from the aperture, overhang extends the end segment', () => {
    for (const f of frames) {
      const up = lidStations(f, 'upper', [-0.22, -0.07, ...STATION_XS]);
      const lo = lidStations(f, 'lower', STATION_XS);
      for (const s of up) expect(s.ny).toBeLessThan(0);
      for (const s of lo) expect(s.ny).toBeGreaterThan(0);
      for (const s of [...up, ...lo]) expect(Math.hypot(s.nx, s.ny)).toBeCloseTo(1, 9);
      const slope = (f.upperPts[3] - f.upperPts[1]) / (f.upperPts[2] - f.upperPts[0]);
      expect(up[0].y).toBeCloseTo(f.upperPts[1] + (-0.22 - f.upperPts[0]) * slope, 9);
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
