import { describe, expect, it } from 'vitest';
import type { Face } from '../../types';
import { FACE_TEMPLATE } from './faceMesh';
import { MASK_MAX_FLOATS, buildMaskGeometry } from './mask';

function face(): Face {
  const oval = new Float32Array(72);
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    oval[i * 2] = 0.5 + 0.21 * Math.sin(a);
    oval[i * 2 + 1] = 0.47 - 0.26 * Math.cos(a);
  }
  return { pts111: new Float32Array(FACE_TEMPLATE), ext: new Float32Array(16), oval, yaw: 0 };
}

describe('buildMaskGeometry', () => {
  it('fills exactly the preallocated buffer and splits base / holes', () => {
    const out = new Float32Array(MASK_MAX_FLOATS);
    const [count, base] = buildMaskGeometry(face(), 1, out);
    expect(count * 3).toBe(MASK_MAX_FLOATS);
    expect(base).toBe(36 * 9);
    for (let i = 0; i < count * 3; i++) expect(Number.isFinite(out[i])).toBe(true);
  });

  it('base: 1 on the oval, 0 on the outer ring; holes: 0 inside, 1 on their rim', () => {
    const out = new Float32Array(MASK_MAX_FLOATS);
    const [count, base] = buildMaskGeometry(face(), 1, out);
    const vals = (from: number, to: number) => {
      const s = new Set<number>();
      for (let v = from; v < to; v++) s.add(out[v * 3 + 2]);
      return s;
    };
    expect(vals(0, base)).toEqual(new Set([0, 1]));
    expect(vals(base, count)).toEqual(new Set([0, 1]));
    let maxOval = 0;
    let minRing = Infinity;
    for (let v = 0; v < base; v++) {
      const d = Math.hypot(out[v * 3] - 0.5, out[v * 3 + 1] - 0.47);
      if (out[v * 3 + 2] === 1) maxOval = Math.max(maxOval, d);
      else minRing = Math.min(minRing, d);
    }
    // ring vertices sit 8% of the face width outside the oval
    const faceW = FACE_TEMPLATE[64] - FACE_TEMPLATE[0];
    expect(minRing).toBeGreaterThan(0.21 + 0.08 * faceW * 0.99);
    expect(maxOval).toBeCloseTo(0.26, 5);
  });

  it('fans come first (value 1), then the ring (1 → 0), then the holes', () => {
    const out = new Float32Array(MASK_MAX_FLOATS);
    const [, base, fanEnd] = buildMaskGeometry(face(), 1, out);
    expect(fanEnd).toBe(36 * 3);
    for (let v = 0; v < fanEnd; v++) expect(out[v * 3 + 2]).toBe(1);
    const ring = new Set<number>();
    for (let v = fanEnd; v < base; v++) ring.add(out[v * 3 + 2]);
    expect([...ring].sort()).toEqual([0, 1]);
  });

  it('an explicit ring width moves the ring vertices that far out (膚色 wide ring, skin-cleanup spec §4.2)', () => {
    const out = new Float32Array(MASK_MAX_FLOATS);
    const [, base] = buildMaskGeometry(face(), 1, out, 0.12);
    let minRing = Infinity;
    for (let v = 0; v < base; v++) if (out[v * 3 + 2] === 0) minRing = Math.min(minRing, Math.hypot(out[v * 3] - 0.5, out[v * 3 + 1] - 0.47));
    expect(minRing).toBeGreaterThan(0.21 + 0.12 * 0.99);
  });

  /**
   * CPU raster of the 磨皮 channel in MaskPass.drawFaces' order (S §4.2): every ring with MAX, every fan with blending
   * off, every hole with MIN, each fragment k · smoothstep(0, 1, v) over a clear of 0 (the editor: no globalSkin).
   */
  function raster(faces: { f: Face; k: number }[], N: number): Float32Array {
    const img = new Float32Array(N * N);
    const geo = faces.map(({ f, k }) => {
      const out = new Float32Array(MASK_MAX_FLOATS);
      const [count, base, fanEnd] = buildMaskGeometry(f, 1, out);
      return { out, count, base, fanEnd, k };
    });
    const fill = (out: Float32Array, from: number, to: number, k: number, op: 'max' | 'set' | 'min') => {
      for (let t = from; t + 2 < to; t += 3) {
        const P = [0, 1, 2].map((j) => [out[(t + j) * 3], out[(t + j) * 3 + 1], out[(t + j) * 3 + 2]]);
        const [[x0, y0], [x1, y1], [x2, y2]] = P;
        const d = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
        if (Math.abs(d) < 1e-12) continue;
        for (let py = 0; py < N; py++) {
          for (let px = 0; px < N; px++) {
            const x = (px + 0.5) / N;
            const y = (py + 0.5) / N;
            const a = ((x1 - x) * (y2 - y) - (x2 - x) * (y1 - y)) / d;
            const b = ((x2 - x) * (y0 - y) - (x0 - x) * (y2 - y)) / d;
            const c = 1 - a - b;
            if (a < 0 || b < 0 || c < 0) continue;
            // GLSL smoothstep(0, 1, v) clamps v first
            const v = Math.min(1, Math.max(0, a * P[0][2] + b * P[1][2] + c * P[2][2]));
            const val = k * v * v * (3 - 2 * v);
            const i = py * N + px;
            img[i] = op === 'max' ? Math.max(img[i], val) : op === 'min' ? Math.min(img[i], val) : val;
          }
        }
      }
    };
    for (const g of geo) fill(g.out, g.fanEnd, g.base, g.k, 'max');
    for (const g of geo) fill(g.out, 0, g.fanEnd, g.k, 'set');
    for (const g of geo) fill(g.out, g.base, g.count, g.k, 'min');
    return img;
  }

  it('two faces in the pass order: a neutral face keeps 0 inside its oval although its neighbour’s ring reaches in (S §4.2, §8.2)', () => {
    const N = 160;
    const at = (img: Float32Array, x: number, y: number) => img[Math.floor(y * N) * N + Math.floor(x * N)];
    const shift = (f: Face, dx: number): Face => ({
      ...f,
      pts111: f.pts111.map((v, i) => (i % 2 === 0 ? v + dx : v)),
      oval: f.oval.map((v, i) => (i % 2 === 0 ? v + dx : v)),
    });
    // ovals 0.01 apart (A ends at x 0.495, B starts at 0.505); A's ring is 8 % of the template's 0.396 face width ≈ 0.032
    const img = raster([{ f: shift(face(), -0.215), k: 1 }, { f: shift(face(), 0.215), k: 0 }], N);
    expect(at(img, 0.5, 0.47)).toBeGreaterThan(0); // the gap: A's ring
    expect(at(img, 0.515, 0.47)).toBe(0); // inside B's oval, still within A's ring: B's own fan (strength 0) wins
    expect(at(img, 0.12, 0.47)).toBe(1); // A's cheek: its full strength
  });
});
