// Synthetic Face edits for tests and the e2e engine harness (never imported by app code): a closed eye, a horizontal
// mirror and a shrunk copy, as face-detail spec §8.1 / §8.3 / §8.4 describe them.
import type { Face } from '../../types';

/** GPUPixel upper-lid points and the lower-lid points they are copied onto, per eye (adapter111.ts DIRECT) */
const LID_PAIRS: readonly (readonly [number, number])[][] = [
  [
    [53, 57],
    [54, 56],
    [72, 73],
  ],
  [
    [59, 63],
    [60, 62],
    [75, 76],
  ],
];

/** Upper-lid points copied onto the lower lid (pts111 and Face.lids), the iris and pupil moved onto the lid line. */
export function closeEye(face: Face, eye: 0 | 1): Face {
  const pts111 = face.pts111.slice();
  const lids = face.lids.slice();
  const iris = face.iris.slice();
  for (const [u, l] of LID_PAIRS[eye]) {
    pts111[u * 2] = pts111[l * 2];
    pts111[u * 2 + 1] = pts111[l * 2 + 1];
  }
  const o = eye * 16;
  for (let j = 1; j <= 7; j++) {
    lids[(o + j) * 2] = lids[(o + j + 8) * 2];
    lids[(o + j) * 2 + 1] = lids[(o + j + 8) * 2 + 1];
  }
  const mid = eye === 0 ? 73 : 76;
  for (let b = 0; b < 5; b++) {
    iris[eye * 10 + b * 2] = pts111[mid * 2];
    iris[eye * 10 + b * 2 + 1] = pts111[mid * 2 + 1];
  }
  const pupil = eye === 0 ? 104 : 105;
  pts111[pupil * 2] = pts111[mid * 2];
  pts111[pupil * 2 + 1] = pts111[mid * 2 + 1];
  return { ...face, pts111, lids, iris };
}

const mapXY = (a: Float32Array, f: (x: number, y: number) => [number, number]): Float32Array => {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i += 2) {
    const q = f(a[i], a[i + 1]);
    out[i] = q[0];
    out[i + 1] = q[1];
  }
  return out;
};

/** x → 1 − x everywhere; the GPUPixel index halves stay, so the GPUPixel-left eye now shows on the right */
export function mirrorFaceX(face: Face): Face {
  const m = (x: number, y: number): [number, number] => [1 - x, y];
  return {
    pts111: mapXY(face.pts111, m),
    ext: mapXY(face.ext, m),
    oval: mapXY(face.oval, m),
    iris: mapXY(face.iris, m),
    lids: mapXY(face.lids, m),
    yaw: -face.yaw,
  };
}

/** every point scaled by `s` about `centre` (UV): a smaller face with the same shape */
export function scaleFace(face: Face, s: number, centre: [number, number]): Face {
  const m = (x: number, y: number): [number, number] => [centre[0] + (x - centre[0]) * s, centre[1] + (y - centre[1]) * s];
  return {
    pts111: mapXY(face.pts111, m),
    ext: mapXY(face.ext, m),
    oval: mapXY(face.oval, m),
    iris: mapXY(face.iris, m),
    lids: mapXY(face.lids, m),
    yaw: face.yaw,
  };
}
