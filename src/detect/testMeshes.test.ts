import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FACE_OVAL } from '../tracking/faceOval';
import { MIRROR, sampleFaceAt } from './testMeshes';

const fx = JSON.parse(readFileSync(new URL('../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as {
  width: number;
  height: number;
  points: number[];
  /** the detector's landmarks on the horizontally flipped photo, in its own coordinates */
  mirrored: number[];
};

describe('sampleFaceAt (test double)', () => {
  it('mirrored, its landmarks are labelled as MediaPipe labels the flipped photo: 33 is the image-left outer eye corner again', () => {
    const { width: W, height: H, points, mirrored } = fx;
    const xs = FACE_OVAL.map((i) => points[i * 3]);
    const ys = FACE_OVAL.map((i) => points[i * 3 + 1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    // the recorded face where the flipped photo shows it: its oval's bounds mirrored, at its own size
    const m = sampleFaceAt(1 - (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, { mirror: true, width: W, height: H }).points;
    const at = (l: ArrayLike<number>, i: number) => [l[i * 3] * W, l[i * 3 + 1] * H];
    const span = Math.hypot(at(mirrored, 33)[0] - at(mirrored, 263)[0], at(mirrored, 33)[1] - at(mirrored, 263)[1]);
    const gap = (i: number) => Math.hypot(at(m, i)[0] - at(mirrored, i)[0], at(m, i)[1] - at(mirrored, i)[1]) / span;
    let worst = 0;
    for (let i = 0; i < 478; i++) worst = Math.max(worst, gap(i));
    expect(worst).toBeLessThan(0.05);
    expect(at(m, 33)[0]).toBeLessThan(at(m, 263)[0]);
    // the same points without the swap put each bilateral landmark on the other side of the face
    const unswapped = (i: number) => Math.hypot((1 - points[i * 3]) * W - at(mirrored, i)[0], points[i * 3 + 1] * H - at(mirrored, i)[1]) / span;
    for (const i of [33, 133, 362, 263, 98, 327, 61, 291]) expect(unswapped(i), `landmark ${i}`).toBeGreaterThan(0.25);
  });
  it('MIRROR pairs each landmark with one other or itself, and keeps the midline (the nose tip, the point above it) in place', () => {
    expect(MIRROR).toHaveLength(478);
    expect(MIRROR.every((m, i) => MIRROR[m] === i)).toBe(true);
    expect(MIRROR.filter((m, i) => m === i)).toHaveLength(28);
    expect([33, 133, 98, 61, 234, 468].map((i) => MIRROR[i])).toEqual([263, 362, 327, 291, 454, 473]);
    expect([1, 4, 10, 152].map((i) => MIRROR[i])).toEqual([1, 4, 10, 152]);
  });
});
