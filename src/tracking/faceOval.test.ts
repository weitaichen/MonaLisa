import { FaceLandmarker } from '@mediapipe/tasks-vision';
import { describe, expect, it } from 'vitest';
import { chainLoop, FACE_OVAL } from './faceOval';

describe('FACE_OVAL', () => {
  it('equals the chained tasks-vision FACE_LANDMARKS_FACE_OVAL edge list', () => {
    const edges = FaceLandmarker.FACE_LANDMARKS_FACE_OVAL;
    expect(edges.length).toBe(36);
    expect(chainLoop(edges, 10)).toEqual(FACE_OVAL);
  });

  it('is a closed loop of 36 distinct vertices', () => {
    expect(new Set(FACE_OVAL).size).toBe(36);
    const edges = FaceLandmarker.FACE_LANDMARKS_FACE_OVAL.map((e) => [e.start, e.end].sort().join('-'));
    for (let i = 0; i < 36; i++) {
      const a = FACE_OVAL[i];
      const b = FACE_OVAL[(i + 1) % 36];
      expect(edges).toContain([a, b].sort().join('-'));
    }
  });

  it('chainLoop rejects edge lists that are not one simple loop', () => {
    expect(() => chainLoop([{ start: 1, end: 2 }, { start: 2, end: 3 }], 1)).toThrow();
    const twoLoops = [
      { start: 1, end: 2 }, { start: 2, end: 3 }, { start: 3, end: 1 },
      { start: 4, end: 5 }, { start: 5, end: 6 }, { start: 6, end: 4 },
    ];
    expect(() => chainLoop(twoLoops, 1)).toThrow();
  });
});
