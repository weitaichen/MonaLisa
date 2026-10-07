import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { adapt, yawProxy } from './adapter111';
import { FACE_OVAL } from './faceOval';

interface Fixture {
  width: number;
  height: number;
  points: number[];
  /** landmarks of the horizontally flipped image, in its own coordinates */
  mirrored: number[];
}
const fx = JSON.parse(readFileSync('tests/fixtures/landmarks_sample_face.json', 'utf8')) as Fixture;
const W = fx.width;
const H = fx.height;
const face = adapt({ points: new Float32Array(fx.points) }, W, H);

/** adapted point i in pixels */
const P = (f: { pts111: Float32Array }, i: number): [number, number] => [f.pts111[i * 2] * W, f.pts111[i * 2 + 1] * H];
const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const IOD = dist(P(face, 74), P(face, 77));
const mp = (i: number): [number, number] => [fx.points[i * 3], fx.points[i * 3 + 1]];

/** GPUPixel left/right pairs (image-left first). Unlisted indices lie on the midline. */
const PAIRS: [number, number][] = [];
for (let k = 0; k < 16; k++) PAIRS.push([k, 32 - k]);
for (let k = 0; k < 5; k++) PAIRS.push([33 + k, 42 - k]);
PAIRS.push([47, 51], [48, 50], [52, 61], [53, 60], [54, 59], [55, 58], [56, 63], [57, 62]);
for (let k = 0; k < 4; k++) PAIRS.push([64 + k, 71 - k]);
PAIRS.push(
  [72, 75], [73, 76], [74, 77], [78, 79], [80, 81], [82, 83], [84, 90], [85, 89], [86, 88],
  [91, 95], [92, 94], [96, 100], [97, 99], [101, 103], [104, 105], [107, 108], [109, 110],
);
const MIRROR = Array.from({ length: 111 }, (_, i) => i);
for (const [a, b] of PAIRS) {
  MIRROR[a] = b;
  MIRROR[b] = a;
}

describe('adapt (sample_face fixture)', () => {
  it('produces the contract shapes', () => {
    expect(face.pts111.length).toBe(222);
    expect(face.ext.length).toBe(16);
    expect(face.oval.length).toBe(72);
    expect(FACE_OVAL.length).toBe(36);
  });

  it('has no NaN and everything inside [0,1]', () => {
    for (const a of [face.pts111, face.ext, face.oval]) {
      for (const v of a) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    expect(Number.isFinite(face.yaw)).toBe(true);
  });

  it('orders eyes image-left → image-right', () => {
    const xs = [52, 74, 55, 58, 77, 61].map((i) => face.pts111[i * 2]);
    for (let k = 1; k < xs.length; k++) expect(xs[k]).toBeGreaterThan(xs[k - 1]);
    // MPI 6368: GPUPixel-left comes from MediaPipe RIGHT_*; x(33) < x(468) < x(133) < x(362)
    expect(mp(33)[0]).toBeLessThan(mp(468)[0]);
    expect(mp(468)[0]).toBeLessThan(mp(133)[0]);
    expect(mp(133)[0]).toBeLessThan(mp(362)[0]);
  });

  it('maps contour endpoints and the shared chin exactly', () => {
    const at = (i: number) => [face.pts111[i * 2], face.pts111[i * 2 + 1]];
    const mid = (a: number, b: number) => [(mp(a)[0] + mp(b)[0]) / 2, (mp(a)[1] + mp(b)[1]) / 2];
    for (const [got, want] of [
      [at(0), mid(162, 127)],
      [at(16), mp(152)],
      [at(32), mid(356, 389)],
    ]) {
      expect(got[0]).toBeCloseTo(want[0], 6);
      expect(got[1]).toBeCloseTo(want[1], 6);
    }
  });

  it('has a monotone contour with the chin lowest at 16', () => {
    for (let k = 1; k <= 16; k++) expect(P(face, k)[1]).toBeGreaterThan(P(face, k - 1)[1]);
    for (let k = 17; k <= 32; k++) expect(P(face, k)[1]).toBeLessThan(P(face, k - 1)[1]);
    for (let k = 0; k <= 32; k++) if (k !== 16) expect(P(face, k)[1]).toBeLessThan(P(face, 16)[1]);
    // left half runs left → chin, right half chin → right (the top of the right half curves back
    // in towards the temple on this turned face, so only the jaw part is checked there)
    for (let k = 1; k <= 16; k++) expect(P(face, k)[0]).toBeGreaterThan(P(face, k - 1)[0]);
    for (let k = 17; k <= 28; k++) expect(P(face, k)[0]).toBeGreaterThan(P(face, k - 1)[0]);
  });

  it('spaces each contour half evenly in pixel space', () => {
    for (const [a, b] of [[0, 16], [16, 32]]) {
      const chords: number[] = [];
      for (let k = a + 1; k <= b; k++) chords.push(dist(P(face, k), P(face, k - 1)));
      const mean = chords.reduce((s, c) => s + c, 0) / chords.length;
      // chords can only be shorter than the arc steps (corners); never longer
      for (const c of chords) {
        expect(c).toBeLessThanOrEqual(mean * 1.06);
        expect(c).toBeGreaterThan(mean * 0.85);
      }
    }
  });

  it('computes 106–110 by the template midpoint rules exactly', () => {
    const rules: [number, number, number][] = [
      [106, 98, 102],
      [107, 35, 65],
      [108, 40, 70],
      [109, 5, 80],
      [110, 27, 81],
    ];
    for (const [d, a, b] of rules) {
      for (const c of [0, 1]) {
        expect(face.pts111[d * 2 + c]).toBe(Math.fround((face.pts111[a * 2 + c] + face.pts111[b * 2 + c]) * 0.5));
      }
    }
  });

  it('places symmetric pairs on opposite sides of the facial midline', () => {
    // least-squares line x = a + b·y through midline points (in pixels)
    const mids = [43, 44, 45, 46, 49, 87, 98, 102, 93, 16];
    let sx = 0, sy = 0, syy = 0, sxy = 0;
    for (const i of mids) {
      const [x, y] = P(face, i);
      sx += x; sy += y; syy += y * y; sxy += x * y;
    }
    const n = mids.length;
    const b = (n * sxy - sx * sy) / (n * syy - sy * sy);
    const a = (sx - b * sy) / n;
    const len = Math.hypot(b, 1);
    const side = (i: number) => {
      const [x, y] = P(face, i);
      return (x - (a + b * y)) / len; // signed perpendicular distance
    };
    const along = (i: number) => {
      const [x, y] = P(face, i);
      return (b * (x - a) + y) / len;
    };
    for (const i of mids) expect(Math.abs(side(i)) / IOD).toBeLessThan(0.1);
    for (const [l, r] of PAIRS) {
      expect(Math.sign(side(l))).toBe(-Math.sign(side(r)));
      // pairs sit at the same height along the midline; the turned face skews the contour (and
      // the cheek centres 109/110 derived from it) more
      const loose = l <= 32 || l === 109;
      expect(Math.abs(along(l) - along(r)) / IOD).toBeLessThan(loose ? 0.4 : 0.12);
    }
  });

  it('is mirror-consistent: adapt(flipped image) mirrored back equals the paired points', () => {
    const fm = adapt({ points: new Float32Array(fx.mirrored) }, W, H);
    let worst = 0;
    for (let i = 0; i < 111; i++) {
      const back: [number, number] = [(1 - fm.pts111[i * 2]) * W, fm.pts111[i * 2 + 1] * H];
      const d = dist(back, P(face, MIRROR[i])) / IOD;
      worst = Math.max(worst, d);
      expect(d, `point ${i} vs ${MIRROR[i]}`).toBeLessThan(0.06);
    }
    expect(worst).toBeGreaterThan(0); // the comparison really ran on distinct detections
    // the yaw proxy flips sign under mirroring
    expect(fm.yaw).toBeCloseTo(-face.yaw, 1);
  });

  it('maps ext anchors and the oval in their documented order', () => {
    const ext = [10, 151, 9, 168, 152, 199, 234, 454];
    ext.forEach((m, i) => {
      expect(face.ext[i * 2]).toBe(Math.fround(fx.points[m * 3]));
      expect(face.ext[i * 2 + 1]).toBe(Math.fround(fx.points[m * 3 + 1]));
    });
    FACE_OVAL.forEach((m, i) => {
      expect(face.oval[i * 2]).toBe(Math.fround(fx.points[m * 3]));
      expect(face.oval[i * 2 + 1]).toBe(Math.fround(fx.points[m * 3 + 1]));
    });
  });

  it('reports the turned face as moderately yawed', () => {
    expect(face.yaw).toBeCloseTo(yawProxy(face.pts111, W, H), 12);
    expect(face.yaw).toBeLessThan(-0.05);
    expect(face.yaw).toBeGreaterThan(-0.35);
  });
});

describe('adapt (synthetic)', () => {
  /** Left contour chain on an L (horizontal leg, then vertical); every other vertex at (0.5, 0.5). */
  function lShaped(width: number, height: number) {
    const p = new Float32Array(478 * 3).fill(0.5);
    const chain = [127, 234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152];
    const set = (i: number, x: number, y: number) => {
      p[i * 3] = x;
      p[i * 3 + 1] = y;
    };
    set(162, 0, 0);
    set(127, 0, 0); // mid(162,127) = (0,0)
    // vertices 1..6 along the horizontal leg to the corner (0.5, 0), 7..11 down to (0.5, 1)
    for (let k = 1; k < chain.length; k++) set(chain[k], k <= 6 ? (0.5 * k) / 6 : 0.5, k <= 6 ? 0 : (k - 6) / 5);
    return adapt({ points: p }, width, height);
  }

  it('resamples by isotropic pixel arc length, not normalized length', () => {
    // 1000×100 px: horizontal leg 500 px, vertical leg 100 px → 500/600 of the 16 steps on it
    const f = lShaped(1000, 100);
    const onLeg = Array.from({ length: 17 }, (_, k) => f.pts111[k * 2 + 1]).filter((y) => y < 1e-6).length;
    expect(onLeg).toBe(14); // k·600/16 ≤ 500 → k ≤ 13.33, plus k = 0
    const g = lShaped(100, 1000); // horizontal 50 px, vertical 1000 px
    const onLeg2 = Array.from({ length: 17 }, (_, k) => g.pts111[k * 2 + 1]).filter((y) => y < 1e-6).length;
    expect(onLeg2).toBe(1);
    // right half: chin (0.5, 1) then 12 coincident vertices at (0.5, 0.5) — zero-length segments
    // must not produce NaN, and the single real segment is split evenly
    for (let k = 16; k <= 32; k++) {
      expect(g.pts111[k * 2]).toBeCloseTo(0.5, 6);
      expect(g.pts111[k * 2 + 1]).toBeCloseTo(1 - (0.5 * (k - 16)) / 16, 5);
    }
  });

  it('rejects short input', () => {
    expect(() => adapt({ points: new Float32Array(468 * 3) }, 10, 10)).toThrow();
  });
});
