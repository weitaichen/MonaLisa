import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Landmarks478 } from '../types';
import { boxIoU, prepareFaces } from './faces';

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
