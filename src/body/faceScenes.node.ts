// Test-only (Node): the 瘦臉 background-limit scenes shared by the straightness ratchet (straightness.test.ts) and the
// FaceProtect acceptance (engine/passes/faceProtect.test.ts), so both measure the same faces, masks and protects.
import { readFileSync } from 'node:fs';
import { adapt } from '../tracking/adapter111';
import { buildFaceProtect } from '../tracking/faceProtect';
import type { Face, FaceProtect, PersonMask } from '../types';
import { loadPoseFixture } from './fixtures.node';
import { maskInside } from './straightness';
import { syntheticPortrait } from './synthetic';

export interface FaceScene {
  name: string;
  face: Face;
  width: number;
  height: number;
  /** the person (0..1) at a UV point */
  inside: (u: number, v: number) => number;
  protect: FaceProtect;
}

/** a 192×256 person mask rasterised from `inside`, as the segmenter would hand it over */
function rasterMask(inside: (u: number, v: number) => number): PersonMask {
  const mw = 192;
  const mh = 256;
  const data = new Uint8Array(mw * mh);
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) data[y * mw + x] = Math.round(255 * inside((x + 0.5) / mw, (y + 0.5) / mh));
  return { width: mw, height: mh, data };
}

/** the synthetic cheek-against-a-wall portrait (no hair) */
export function portraitScene(): FaceScene {
  const pr = syntheticPortrait();
  return { name: 'portrait', face: pr.face, width: pr.width, height: pr.height, inside: pr.inside, protect: buildFaceProtect(pr.face, rasterMask(pr.inside), pr.width, pr.height) };
}

/** sample_face (landmarks_sample_face.json) with its recorded person mask (sample_face.pose.json) */
export function sampleFaceScene(): FaceScene {
  const lm = JSON.parse(readFileSync(new URL('../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as {
    width: number;
    height: number;
    points: number[];
  };
  const face = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);
  const mask = loadPoseFixture('sample_face.pose.json')!.mask!;
  return { name: 'sample_face', face, width: lm.width, height: lm.height, inside: maskInside(mask), protect: buildFaceProtect(face, mask, lm.width, lm.height) };
}

/**
 * sample_face (a turned face) with the person = its face oval + a neck-and-shoulders silhouette below the chin, as the
 * selfie segmenter reads the e2e wall portrait (tests/e2e/faceProtect.spec.ts): short hair against a wall
 */
export function sampleWallScene(): FaceScene {
  const base = sampleFaceScene();
  const P = base.face.pts111;
  const fwU = Math.hypot((P[0] - P[64]) * base.width, (P[1] - P[65]) * base.height) / base.width;
  const chin = [P[32], P[33]];
  const oval = base.face.oval;
  const n = oval.length / 2;
  const inOval = (u: number, v: number) => {
    let c = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      if (oval[i * 2 + 1] > v !== oval[j * 2 + 1] > v && u < ((oval[j * 2] - oval[i * 2]) * (v - oval[i * 2 + 1])) / (oval[j * 2 + 1] - oval[i * 2 + 1]) + oval[i * 2]) c = !c;
    }
    return c;
  };
  const inside = (u: number, v: number) =>
    inOval(u, v) || (v > chin[1] - 0.05 && Math.abs(u - chin[0]) < 0.2 * fwU + Math.max(0, v - chin[1] - 0.06) * 3) ? 1 : 0;
  return { ...base, name: 'sample_wall', inside, protect: buildFaceProtect(base.face, rasterMask(inside), base.width, base.height) };
}
